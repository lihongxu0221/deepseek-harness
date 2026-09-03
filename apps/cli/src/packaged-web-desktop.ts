/**
 * Packaged Windows Web desktop host: splash, tray, single-instance pipe,
 * and a web-profile lifetime that is not tied to the Chromium window.
 * @module @deepseek-ai/dsh/packaged-web-desktop
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  desktopListenArgs,
  loadDesktopListen,
  saveDesktopListen,
  type DesktopListen,
} from './desktop-listen.ts'
import {
  defaultDesktopWindowIo,
  DESKTOP_WINDOW_HANDOFF_MS,
  openDesktopWindow,
  type OpenedDesktopWindow,
} from './open-desktop-window.ts'
import { bootProfile, type BootProfileOptions } from './profile-boot.ts'
import {
  defaultWindowsDesktopShellIo,
  parseShellToHost,
  startWindowsDesktopShell,
  type HostToShell,
  type ShellToHost,
  type WindowsDesktopShell,
  type WindowsDesktopShellIo,
} from './windows-desktop-shell.ts'

const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\'

/**
 * Backoff before relaunching a tray host that exited on its own. The first
 * death relaunches at once; a tray that keeps dying settles at the last delay
 * instead of respawning a window several times a second.
 */
const TRAY_RESTART_DELAYS_MS = [0, 1_000, 2_000, 5_000, 15_000, 30_000]

/** A claimed single-instance lock. Guests hold nothing to close. */
export interface DesktopInstanceLock {
  /** Owner listens; guest already forwarded `show` and should exit. */
  role: 'owner' | 'guest'
  /** Release the named pipe or unix socket. */
  close(): void
}

/**
 * Named pipe (Windows) or temp socket (tests on POSIX) for one harness home.
 * @param home - resolved `$DSH_HOME`.
 * @param platform - pipe vs socket; production Windows always passes `win32`.
 * @returns the listen path.
 */
export function desktopPipeName(home: string, platform: NodeJS.Platform = process.platform): string {
  const id = createHash('sha256').update(home).digest('hex').slice(0, 16)
  if (platform === 'win32') return WINDOWS_PIPE_PREFIX + 'dsh-web-' + id
  return join(tmpdir(), 'dsh-web-' + id + '.sock')
}

function isWindowsPipe(path: string): boolean {
  return path.startsWith('\\\\.\\pipe\\')
}

function isAddrInUse(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

function listenPipe(server: net.Server, path: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolvePromise()
    }
    server.once('error', onError)
    server.listen(path, onListening)
  })
}

function sendGuestShow(path: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const socket = net.createConnection(path)
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.end('{"type":"show"}\n')
    })
    socket.once('close', () => { resolvePromise() })
  })
}

/**
 * Accept only `show` from a second process. Start, stop, listen, and quit
 * stay on the tray stdin so a local connector cannot rebind or exit the host.
 * @param line - one JSON line from the single-instance pipe.
 * @returns the show command, or `undefined` for any other payload.
 */
export function parseDesktopGuestCommand(line: string): Extract<ShellToHost, { type: 'show' }> | undefined {
  const command = parseShellToHost(line)
  return command?.type === 'show' ? command : undefined
}

function attachGuestReader(socket: net.Socket, onShow: () => void): void {
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (parseDesktopGuestCommand(line) !== undefined) onShow()
      index = buffer.indexOf('\n')
    }
  })
}

/**
 * Listen on `pipeName`, or connect as a guest and send `show` when the name
 * is already owned. The owner accepts only `show` on this pipe.
 * @param pipeName - {@link desktopPipeName} for this home.
 * @param onShow - owner callback when a guest asks to show the window.
 * @returns the lock. Guests should exit after this resolves.
 */
export async function claimDesktopInstance(
  pipeName: string,
  onShow: () => void,
): Promise<DesktopInstanceLock> {
  const server = net.createServer((socket) => { attachGuestReader(socket, onShow) })
  try {
    await listenPipe(server, pipeName)
    return {
      role: 'owner',
      close() {
        server.close()
        if (!isWindowsPipe(pipeName)) {
          try {
            unlinkSync(pipeName)
          } catch {
            // POSIX socket file is best-effort cleanup after close.
          }
        }
      },
    }
  } catch (error) {
    server.close()
    if (!isAddrInUse(error)) throw error
    await sendGuestShow(pipeName)
    return { role: 'guest', close() { /* guest owns no listener */ } }
  }
}

/** Replaceable effects for {@link runPackagedWebDesktop}. */
export interface PackagedWebDesktopIo {
  /** Resolved harness home used for the single-instance pipe. */
  home: string
  /** Packaged executable path, used as the tray icon source. */
  execPath: string
  /** Frozen launch environment handed to {@link bootProfile}. */
  environment: LaunchEnvironmentSnapshot
  /**
   * Install the launch-environment proxy before the profile mounts.
   * @param environment - frozen launch snapshot.
   * @returns a disposer restoring the previous dispatcher.
   */
  installProxy(environment: LaunchEnvironmentSnapshot): Promise<() => Promise<void>>
  /** Inner argv for `ctx.cmdlineArgs`. */
  args: readonly string[]
  /**
   * Compose and boot the web profile without installing process-exit handlers.
   * @param options - boot options including the plugin exit hook.
   * @returns the root context. The host owns `fiber.dispose()`.
   */
  bootProfile(options: BootProfileOptions): Promise<Context>
  /**
   * Open the Chromium app window or OS opener.
   * @param url - loopback URL, optionally with `#settings`.
   * @returns a waitable window, or `undefined` for a fire-and-forget opener.
   */
  openWindow(url: string): OpenedDesktopWindow | undefined
  /**
   * Start the splash/tray host.
   * @param io - PowerShell I/O bag.
   * @returns the live JSON-line session.
   */
  startShell(io: WindowsDesktopShellIo): WindowsDesktopShell
  /** I/O bag passed to {@link startShell}. */
  shellIo: WindowsDesktopShellIo
  /**
   * Claim the single-instance lock for `home`.
   * @param home - resolved harness home.
   * @param onShow - owner callback when a guest asks to show the window.
   * @returns owner or guest lock.
   */
  claimInstance(home: string, onShow: () => void): Promise<DesktopInstanceLock>
  /**
   * Process exit. Production calls `process.exit`; tests record the code.
   * @param code - process exit code.
   */
  exit(code: number): void
  /**
   * Read the persisted listen address, or the default when the file is missing.
   * @returns the address the next boot will bind.
   */
  loadListen(): DesktopListen
  /**
   * Persist a listen address chosen from the tray.
   * @param listen - validated host and port.
   */
  saveListen(listen: DesktopListen): void
  /**
   * Surface a fatal error when the tray is not yet running. The GUI
   * subsystem has no console; production shows a MessageBox.
   * @param message - already-stringified failure text.
   */
  reportFatal?(message: string): void
}

/**
 * Production I/O: real boot, window, tray, and named-pipe lock.
 * @returns the production I/O bag.
 */
export function defaultPackagedWebDesktopIo(): PackagedWebDesktopIo {
  const execPath = process.execPath
  const home = resolveDshHome()
  return {
    home,
    execPath,
    environment: loadLayeredEnv('dsh'),
    installProxy: environment => installProxyFromEnvironment(
      environment,
      (message) => { process.stderr.write(`dsh: ${message}\n`) },
    ),
    args: process.argv.slice(2),
    bootProfile,
    openWindow: url => openDesktopWindow(url, defaultDesktopWindowIo()),
    startShell: startWindowsDesktopShell,
    shellIo: defaultWindowsDesktopShellIo(execPath, home),
    claimInstance: (claimedHome, onShow) => claimDesktopInstance(desktopPipeName(claimedHome), onShow),
    exit: (code) => { process.exit(code) },
    loadListen: () => loadDesktopListen(home),
    saveListen: (next) => { saveDesktopListen(home, next) },
    reportFatal: (message) => { reportDesktopFatal(home, message) },
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function logDesktop(home: string, message: string): void {
  try {
    appendFileSync(join(home, 'desktop-host.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    // A missing home directory must not take down the tray host.
  }
}

/**
 * Log a pre-tray fatal and show a MessageBox. The GUI-subsystem exe has no
 * console, so `console.error` and `process.exit(1)` are otherwise silent.
 * @param home - resolved `$DSH_HOME`.
 * @param message - already-stringified failure text.
 */
export function reportDesktopFatal(home: string, message: string): void {
  logDesktop(home, message)
  /* v8 ignore next 16 -- production MessageBox; tests inject reportFatal. */
  try {
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($env:DSH_DESKTOP_FATAL, "DeepSeek Harness")',
    ], {
      env: { ...process.env, DSH_DESKTOP_FATAL: message },
      windowsHide: true,
      timeout: 120_000,
    })
  } catch {
    // A missing PowerShell must not loop the GUI launcher.
  }
}

const desktopGuards = Symbol.for('dsh.packagedWebDesktopGuards')

function installDesktopProcessGuards(home: string): void {
  const globalStore = globalThis as typeof globalThis & { [desktopGuards]?: boolean }
  if (globalStore[desktopGuards] === true) return
  globalStore[desktopGuards] = true
  process.on('unhandledRejection', (error) => {
    logDesktop(home, `unhandledRejection ${errorText(error)}`)
  })
  process.on('uncaughtException', (error) => {
    logDesktop(home, `uncaughtException ${errorText(error)}`)
  })
}

/**
 * Run the Windows packaged desktop until Exit. Closing the Chromium window
 * does not stop the web profile; tray Exit does. An unexpected tray-process
 * death restarts the WinForms host and leaves Node running. A second process
 * with the same `$DSH_HOME` sends `show` and returns.
 * @param io - replaceable I/O; production uses {@link defaultPackagedWebDesktopIo}.
 * @returns after the host has asked `io.exit`.
 */
export async function runPackagedWebDesktop(io: PackagedWebDesktopIo): Promise<void> {
  logDesktop(io.home, `start exec=${io.execPath}`)
  installDesktopProcessGuards(io.home)
  let commandSink: (command: ShellToHost) => void = () => undefined
  let lock: DesktopInstanceLock
  try {
    lock = await io.claimInstance(io.home, () => { commandSink({ type: 'show' }) })
  } catch (error) {
    const text = `claimInstance failed ${errorText(error)}`
    logDesktop(io.home, text)
    io.reportFatal?.(errorText(error))
    io.exit(1)
    throw error
  }
  logDesktop(io.home, `role=${lock.role}`)
  if (lock.role === 'guest') {
    io.exit(0)
    return
  }

  let shell: WindowsDesktopShell
  try {
    shell = io.startShell(io.shellIo)
  } catch (error) {
    const text = `startShell failed ${errorText(error)}`
    logDesktop(io.home, text)
    io.reportFatal?.(errorText(error))
    lock.close()
    io.exit(1)
    throw error
  }
  let generation = 0
  let inFlightAbort: AbortController | undefined
  let current: Context | undefined
  let disposeProxy: (() => Promise<void>) | undefined
  let opened: OpenedDesktopWindow | undefined
  /** True only while Show asked the tray to raise an already-tracked window. */
  let raisePending = false
  let running = false
  let port: number | undefined
  let bootRev: string | undefined
  let listen = io.loadListen()
  let chain = Promise.resolve()
  let finished!: () => void
  const done = new Promise<void>((resolvePromise) => { finished = resolvePromise })
  let exited = false

  const send = (message: HostToShell): void => {
    try {
      shell.send(message)
    } catch {
      // Tray stdin may already be closed while we are quitting.
    }
  }

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = chain.then(task, task)
    chain = next.then(() => undefined, () => undefined)
    return next
  }

  const disposeCurrent = async (): Promise<void> => {
    const ctx = current
    current = undefined
    const uninstallProxy = disposeProxy
    disposeProxy = undefined
    if (ctx !== undefined) {
      try {
        await ctx.fiber.dispose()
      } catch {
        // Disposal after abort can reject because the tree is already exiting.
      }
    }
    if (uninstallProxy !== undefined) await uninstallProxy()
  }

  const closeWindow = async (): Promise<void> => {
    const window = opened
    opened = undefined
    if (window === undefined) return
    window.close()
    try {
      await Promise.race([
        window.wait,
        new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 2000) }),
      ])
    } catch {
      // Spawn failure on a window we are discarding is not a boot failure.
    }
  }

  const trackWindow = (window: OpenedDesktopWindow | undefined): void => {
    opened = window
    if (window === undefined) return
    const openedAt = Date.now()
    const forget = (): void => {
      if (opened !== window) return
      if (Date.now() - openedAt < DESKTOP_WINDOW_HANDOFF_MS) return
      opened = undefined
    }
    void window.wait.then(forget, forget)
  }

  const localUrl = (hash?: '#settings'): string => {
    const origin = 'http://127.0.0.1:' + String(port)
    const connection = current?.get('connection') as { authenticatedUrl?: (baseUrl: string) => string } | undefined
    const authenticated = connection?.authenticatedUrl?.(origin)
    const url = new URL(typeof authenticated === 'string' && authenticated.length > 0 ? authenticated : origin)
    if (bootRev !== undefined) url.searchParams.set('boot', bootRev)
    if (hash !== undefined) url.hash = 'settings'
    return url.href
  }

  const sendListen = (url?: string): void => {
    send(url === undefined
      ? { type: 'listen', host: listen.host, port: port ?? listen.port }
      : { type: 'listen', host: listen.host, port: port ?? listen.port, url })
  }

  const start = async (hash?: '#settings'): Promise<void> => {
    if (running) return
    const gen = generation
    inFlightAbort = new AbortController()
    send({ type: 'progress', text: 'Starting Web GUI…', zh: '正在启动 Web 界面…', percent: 20 })
    try {
      if (listen.host === '0.0.0.0') process.env.DSH_WEB_ALLOW_ALL_INTERFACES = '1'
      else delete process.env.DSH_WEB_ALLOW_ALL_INTERFACES
      disposeProxy = await io.installProxy(io.environment)
      const ctx = await io.bootProfile({
        environment: io.environment,
        profile: 'web',
        patchFiles: [],
        args: [...desktopListenArgs(listen), ...io.args],
        exit: () => {
          generation += 1
          inFlightAbort?.abort()
          void enqueue(stop)
        },
        signal: inFlightAbort.signal,
        onHost: (host) => { current = host },
      })
      current = ctx
      if (gen !== generation || inFlightAbort.signal.aborted) {
        await disposeCurrent()
        return
      }
      send({ type: 'progress', text: 'Starting web server…', zh: '正在启动 Web 服务…', percent: 70 })
      const settled = ctx.get('loader')?.await()
      if (settled !== undefined) {
        try {
          await settled
        } catch {
          // Loader already reported the failed boot; the port check decides.
        }
      }
      if (gen !== generation || inFlightAbort.signal.aborted) {
        await disposeCurrent()
        return
      }
      const nextPort = ctx.get('webServer')?.port
      if (nextPort === undefined) {
        await disposeCurrent()
        logDesktop(io.home, 'boot failed: web server did not start')
        send({
          type: 'error',
          text: 'Web server did not start. This executable is a Web GUI, not the JSON-RPC agent.',
          zh: 'Web 服务未能启动。这是 Web 界面，不是 JSON-RPC 代理。',
        })
        send({ type: 'state', running: false })
        return
      }
      port = nextPort
      const modules = ctx.get('clientModules') as { graph(): { rev: string } } | undefined
      bootRev = modules?.graph().rev
      sendListen(localUrl())
      send({ type: 'progress', text: 'Opening window…', zh: '正在打开窗口…', percent: 90 })
      try {
        trackWindow(io.openWindow(localUrl(hash)))
      } catch (error) {
        send({ type: 'error', text: errorText(error), zh: '打开窗口失败。' })
      }
      running = true
      send({ type: 'state', running: true })
      send({ type: 'ready' })
    } catch (error) {
      if (gen !== generation || inFlightAbort.signal.aborted) {
        await disposeCurrent()
        return
      }
      await disposeCurrent()
      logDesktop(io.home, `boot failed ${errorText(error)}`)
      send({ type: 'error', text: errorText(error), zh: 'Web 界面启动失败。' })
      send({ type: 'state', running: false })
    }
  }

  const stop = async (): Promise<void> => {
    raisePending = false
    await closeWindow()
    await disposeCurrent()
    running = false
    port = undefined
    bootRev = undefined
    sendListen()
    send({ type: 'state', running: false })
  }

  const restart = async (hash?: '#settings'): Promise<void> => {
    await stop()
    await start(hash)
  }

  const applyListen = async (next: DesktopListen): Promise<void> => {
    listen = next
    io.saveListen(next)
    sendListen(running && port !== undefined ? localUrl() : undefined)
    if (running) await restart()
  }

  const openTracked = async (hash?: '#settings'): Promise<void> => {
    try {
      const window = io.openWindow(localUrl(hash))
      trackWindow(window)
      if (window?.pid !== undefined) send({ type: 'focus', pid: window.pid })
    } catch (error) {
      send({
        type: 'error',
        text: errorText(error),
        zh: hash === '#settings' ? '打开设置失败。' : '打开窗口失败。',
      })
    }
  }

  const reveal = async (hash?: '#settings'): Promise<void> => {
    raisePending = false
    await closeWindow()
    await openTracked(hash)
  }

  const show = async (): Promise<void> => {
    if (!running) await start()
    if (!running) return
    if (opened !== undefined) {
      raisePending = true
      send(opened.pid === undefined ? { type: 'focus' } : { type: 'focus', pid: opened.pid })
      return
    }
    await openTracked()
  }

  const settings = async (): Promise<void> => {
    if (!running) {
      await start('#settings')
      return
    }
    await reveal('#settings')
  }

  const missingWindow = async (): Promise<void> => {
    if (!raisePending || !running) {
      raisePending = false
      return
    }
    await reveal()
  }

  const quit = async (): Promise<void> => {
    await stop()
    shell.close()
    lock.close()
    if (!exited) {
      exited = true
      finished()
      io.exit(0)
    }
  }

  const dispatch = async (command: ShellToHost): Promise<void> => {
    switch (command.type) {
      case 'show':
        await show()
        return
      case 'start':
        await start()
        return
      case 'stop':
        await stop()
        return
      case 'restart':
        await restart()
        return
      case 'listen':
        await applyListen({ host: command.host, port: command.port })
        return
      case 'settings':
        await settings()
        return
      case 'window-missing':
        await missingWindow()
        return
      case 'quit':
        await quit()
        return
      default: {
        const exhaustive: never = command
        void exhaustive
      }
    }
  }

  const handle = (command: ShellToHost): Promise<void> => {
    if (
      command.type === 'stop'
      || command.type === 'quit'
      || command.type === 'restart'
      || (command.type === 'listen' && running)
    ) {
      generation += 1
      inFlightAbort?.abort()
    }
    return enqueue(async () => {
      try {
        await dispatch(command)
      } catch (error) {
        send({ type: 'error', text: errorText(error), zh: '操作失败。' })
      }
    })
  }

  commandSink = (command) => { void handle(command) }
  let trayRestarts = 0
  const restartShell = (): void => {
    if (exited) return
    try {
      shell = io.startShell(io.shellIo)
      bindShell()
      sendListen(running && port !== undefined ? localUrl() : undefined)
      send({ type: 'state', running })
      if (running) send({ type: 'ready' })
    } catch (error) {
      logDesktop(io.home, `tray restart failed ${errorText(error)}`)
    }
  }
  const bindShell = (): void => {
    shell.onCommand((command) => { void handle(command) })
    shell.onExit(() => {
      if (exited) return
      const delay = TRAY_RESTART_DELAYS_MS[Math.min(trayRestarts, TRAY_RESTART_DELAYS_MS.length - 1)] ?? 0
      trayRestarts += 1
      logDesktop(io.home, `tray exit; restart ${String(trayRestarts)} in ${String(delay)}ms`)
      if (delay === 0) {
        restartShell()
        return
      }
      // A tray that dies on every launch must not spin: the web service is
      // already serving, and the GUI stays reachable without the tray.
      setTimeout(restartShell, delay).unref()
    })
  }
  bindShell()
  sendListen()
  await handle({ type: 'start' })
  await done
}
