import { createConnection } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import {
  claimDesktopInstance,
  desktopPipeName,
  parseDesktopGuestCommand,
  runPackagedWebDesktop,
  type PackagedWebDesktopIo,
} from '../src/packaged-web-desktop.ts'
import type {
  HostToShell,
  ShellToHost,
  WindowsDesktopShell,
} from '../src/windows-desktop-shell.ts'
import type { DesktopListen } from '../src/desktop-listen.ts'
import { DESKTOP_WINDOW_HANDOFF_MS, type OpenedDesktopWindow } from '../src/open-desktop-window.ts'

const environment = {} as LaunchEnvironmentSnapshot
const temps: string[] = []

afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true })
  delete process.env.DSH_WEB_ALLOW_ALL_INTERFACES
})

function fakeWindow(url: string, pid = 9000): OpenedDesktopWindow & { settle(): void; url: string } {
  let resolveWait!: () => void
  const window: OpenedDesktopWindow & { settle(): void; url: string } = {
    wait: new Promise<number>((resolvePromise) => {
      resolveWait = () => { resolvePromise(0) }
    }),
    pid,
    close() { resolveWait() },
    settle() { resolveWait() },
    url,
  }
  return window
}

function fakeCtx(options: {
  port?: number
  dispose?: () => Promise<void>
  loaderReject?: boolean
  bootRev?: string
} = {}): Context {
  return {
    fiber: {
      dispose: options.dispose ?? (async () => undefined),
    },
    get(name: string) {
      if (name === 'loader') {
        return {
          await: async () => {
            if (options.loaderReject) throw new Error('loader failed')
          },
        }
      }
      if (name === 'webServer') {
        return options.port === undefined ? undefined : { port: options.port }
      }
      if (name === 'connection') {
        return {
          authenticatedUrl(baseUrl: string) {
            const url = new URL(baseUrl)
            url.searchParams.set('token', 'test-token')
            return url.href
          },
        }
      }
      if (name === 'clientModules' && options.bootRev !== undefined) {
        return { graph: () => ({ rev: options.bootRev }) }
      }
      return undefined
    },
  } as Context
}

function createHarness(overrides: {
  role?: 'owner' | 'guest'
  claimError?: Error
  boot?: PackagedWebDesktopIo['bootProfile']
  openWindow?: PackagedWebDesktopIo['openWindow']
  bootRev?: string
} = {}) {
  const messages: HostToShell[] = []
  const exits: number[] = []
  const windows: Array<OpenedDesktopWindow & { settle(): void; url?: string }> = []
  const disposed: number[] = []
  let commandHandler: ((command: ShellToHost) => void) | undefined
  let exitHandler: (() => void) | undefined
  let closed = 0
  let shells = 0
  const saved: DesktopListen[] = []
  const fatals: string[] = []
  let listen: DesktopListen = { host: '127.0.0.1', port: 3080 }
  const bootArgs: string[][] = []
  const shell: WindowsDesktopShell = {
    send(message) { messages.push(message) },
    onCommand(handler) { commandHandler = handler },
    onExit(handler) { exitHandler = handler },
    close() { closed += 1 },
  }
  let lockClosed = 0
  const io: PackagedWebDesktopIo = {
    home: 'D:\\home',
    execPath: 'D:\\dist\\dsh-web.exe',
    environment,
    installProxy: async () => async () => undefined,
    args: [],
    bootProfile: async (options) => {
      bootArgs.push([...options.args])
      if (overrides.boot !== undefined) return overrides.boot(options)
      return fakeCtx({
        port: 3080,
        dispose: async () => { disposed.push(1) },
        ...(overrides.bootRev === undefined ? {} : { bootRev: overrides.bootRev }),
      })
    },
    openWindow: overrides.openWindow ?? ((url) => {
      const window = fakeWindow(url)
      windows.push(window)
      return window
    }),
    startShell: () => {
      shells += 1
      return shell
    },
    shellIo: {
      parentPid: 1,
      execPath: 'D:\\dist\\dsh-web.exe',
      scriptDir: 'h',
      spawn: () => { throw new Error('unused') },
      writeFile() { /* unused */ },
      unlink() { /* unused */ },
    },
    claimInstance: async (_home, _onShow) => {
      if (overrides.claimError !== undefined) throw overrides.claimError
      if (overrides.role === 'guest') return { role: 'guest', close() { lockClosed += 1 } }
      return { role: 'owner', close() { lockClosed += 1 } }
    },
    exit(code) { exits.push(code) },
    loadListen: () => listen,
    saveListen(next) {
      listen = next
      saved.push(next)
    },
    reportFatal(message) { fatals.push(message) },
  }
  return {
    io,
    messages,
    exits,
    fatals,
    saved,
    bootArgs,
    windows,
    disposed,
    get closed() { return closed },
    get shells() { return shells },
    get lockClosed() { return lockClosed },
    emit(command: ShellToHost) { commandHandler?.(command) },
    crashShell() { exitHandler?.() },
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 2000) throw new Error('timed out')
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 5) })
  }
}

describe('desktopPipeName', () => {
  it('uses a named pipe on Windows and a temp socket elsewhere', () => {
    expect(desktopPipeName('D:\\home', 'win32')).toMatch(/^\\\\\.\\pipe\\dsh-web-[0-9a-f]{16}$/)
    expect(desktopPipeName('/tmp/home', 'linux')).toMatch(/dsh-web-[0-9a-f]{16}\.sock$/)
    expect(desktopPipeName('D:\\home', 'win32')).toBe(desktopPipeName('D:\\home', 'win32'))
    expect(desktopPipeName('D:\\home', 'win32')).not.toBe(desktopPipeName('E:\\other', 'win32'))
  })
})

describe('parseDesktopGuestCommand', () => {
  it('accepts show and drops every other tray command', () => {
    expect(parseDesktopGuestCommand('{"type":"show"}')).toEqual({ type: 'show' })
    expect(parseDesktopGuestCommand('{"type":"quit"}')).toBeUndefined()
    expect(parseDesktopGuestCommand('{"type":"stop"}')).toBeUndefined()
    expect(parseDesktopGuestCommand('{"type":"listen","host":"0.0.0.0","port":8080}')).toBeUndefined()
    expect(parseDesktopGuestCommand('{"type":"start"}')).toBeUndefined()
    expect(parseDesktopGuestCommand('{"type":"restart"}')).toBeUndefined()
    expect(parseDesktopGuestCommand('{"type":"settings"}')).toBeUndefined()
    expect(parseDesktopGuestCommand('{"type":"window-missing"}')).toBeUndefined()
  })
})

describe('claimDesktopInstance', () => {
  it('forwards show from a second process to the owner', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-lock-'))
    temps.push(home)
    const pipe = desktopPipeName(home)
    let shows = 0
    const owner = await claimDesktopInstance(pipe, () => { shows += 1 })
    expect(owner.role).toBe('owner')
    const guest = await claimDesktopInstance(pipe, () => undefined)
    expect(guest.role).toBe('guest')
    await waitFor(() => shows === 1)
    guest.close()
    owner.close()
  })

  it('ignores quit and listen on the single-instance pipe', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-lock-'))
    temps.push(home)
    const pipe = desktopPipeName(home)
    let shows = 0
    const owner = await claimDesktopInstance(pipe, () => { shows += 1 })
    await new Promise<void>((resolvePromise, reject) => {
      const socket = createConnection(pipe)
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.end(
          '{"type":"quit"}\n{"type":"listen","host":"0.0.0.0","port":1}\n{"type":"show"}\n',
        )
      })
      socket.once('close', () => { resolvePromise() })
    })
    await waitFor(() => shows === 1)
    expect(shows).toBe(1)
    owner.close()
  })
})

describe('runPackagedWebDesktop', () => {
  it('exits as a guest without starting the tray', async () => {
    const harness = createHarness({ role: 'guest' })
    await runPackagedWebDesktop(harness.io)
    expect(harness.exits).toEqual([0])
    expect(harness.messages).toEqual([])
  })

  it('exits 1 when the single-instance lock cannot be claimed', async () => {
    const harness = createHarness({ claimError: new Error('pipe failed') })
    await expect(runPackagedWebDesktop(harness.io)).rejects.toThrow(/pipe failed/)
    expect(harness.exits).toEqual([1])
    expect(harness.fatals).toEqual(['pipe failed'])
  })

  it('exits 1 when the tray host cannot start', async () => {
    const harness = createHarness()
    harness.io.startShell = () => { throw new Error('powershell missing') }
    await expect(runPackagedWebDesktop(harness.io)).rejects.toThrow(/powershell missing/)
    expect(harness.exits).toEqual([1])
    expect(harness.fatals).toEqual(['powershell missing'])
    expect(harness.lockClosed).toBe(1)
  })

  it('boots, reports progress, opens the main window, and stays up after the window closes', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    expect(harness.windows[0]?.url).toBe('http://127.0.0.1:3080/?token=test-token')
    expect(harness.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'progress', percent: 20 }),
      expect.objectContaining({ type: 'progress', percent: 70 }),
      expect.objectContaining({ type: 'progress', percent: 90 }),
      { type: 'listen', host: '127.0.0.1', port: 3080, url: 'http://127.0.0.1:3080/?token=test-token' },
      { type: 'state', running: true },
      { type: 'ready' },
    ]))
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, DESKTOP_WINDOW_HANDOFF_MS + 20) })
    harness.windows[0]?.settle()
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 20) })
    expect(harness.exits).toEqual([])
    harness.emit({ type: 'show' })
    await waitFor(() => harness.windows.length === 2)
    expect(harness.windows[1]?.url).toBe('http://127.0.0.1:3080/?token=test-token')
    expect(harness.messages.filter(message => message.type === 'focus')).toEqual([{ type: 'focus', pid: 9000 }])
    harness.emit({ type: 'quit' })
    await done
    expect(harness.disposed).toEqual([1])
    expect(harness.closed).toBe(1)
    expect(harness.lockClosed).toBe(1)
    expect(harness.exits).toEqual([0])
  })

  it('treats start and stop as mutually exclusive service commands', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    const bootsBefore = harness.messages.filter(message => message.type === 'progress' && message.percent === 20).length
    harness.emit({ type: 'start' })
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 20) })
    expect(harness.messages.filter(message => message.type === 'progress' && message.percent === 20)).toHaveLength(bootsBefore)
    harness.emit({ type: 'stop' })
    await waitFor(() => harness.messages.some(message => message.type === 'state' && message.running === false))
    expect(harness.disposed).toEqual([1])
    harness.emit({ type: 'start' })
    await waitFor(() => harness.messages.filter(message => message.type === 'ready').length === 2)
    expect(harness.windows).toHaveLength(2)
    harness.emit({ type: 'quit' })
    await done
  })

  it('cache-busts the window URL with the client boot graph rev', async () => {
    const harness = createHarness({ bootRev: '15f48add9eef' })
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    expect(harness.windows[0]?.url).toBe('http://127.0.0.1:3080/?token=test-token&boot=15f48add9eef')
    harness.emit({ type: 'quit' })
    await done
  })

  it('opens Settings through #settings, including when the service is stopped', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    harness.emit({ type: 'settings' })
    await waitFor(() => harness.windows.some(window => window.url?.endsWith('#settings')))
    expect(harness.windows.at(-1)?.url).toBe('http://127.0.0.1:3080/?token=test-token#settings')
    harness.emit({ type: 'stop' })
    await waitFor(() => harness.messages.some(message => message.type === 'state' && message.running === false))
    harness.emit({ type: 'settings' })
    await waitFor(() => harness.windows.filter(window => window.url?.endsWith('#settings')).length === 2)
    harness.emit({ type: 'quit' })
    await done
  })

  it('reports a missing web server and a failed boot without exiting the tray', async () => {
    let calls = 0
    const harness = createHarness({
      boot: async () => {
        calls += 1
        if (calls === 1) return fakeCtx({})
        throw new Error('boot exploded')
      },
    })
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'error'))
    expect(harness.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', text: expect.stringMatching(/Web server did not start/) as string }),
      { type: 'state', running: false },
    ]))
    expect(harness.exits).toEqual([])
    harness.emit({ type: 'start' })
    await waitFor(() => harness.messages.filter(message => message.type === 'error').length === 2)
    expect(harness.messages.at(-2)).toEqual(expect.objectContaining({ type: 'error', text: 'boot exploded' }))
    harness.emit({ type: 'quit' })
    await done
    expect(harness.exits).toEqual([0])
  })

  it('aborts an in-flight boot when Stop is clicked', async () => {
    let release!: () => void
    const started = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const harness = createHarness({
      boot: async (options) => {
        release()
        await new Promise<void>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        })
        return fakeCtx({ port: 3080 })
      },
    })
    const done = runPackagedWebDesktop(harness.io)
    await started
    harness.emit({ type: 'stop' })
    await waitFor(() => harness.messages.some(message => message.type === 'state' && message.running === false))
    expect(harness.messages.some(message => message.type === 'ready')).toBe(false)
    harness.emit({ type: 'quit' })
    await done
  })

  it('stops the service when the profile requests exit, and keeps the host if the tray dies once', async () => {
    let pluginExit: ((code: number) => void) | undefined
    const harness = createHarness({
      boot: async (options) => {
        pluginExit = options.exit
        return fakeCtx({
          port: 3080,
          loaderReject: true,
          dispose: async () => { /* unused */ },
        })
      },
    })
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    pluginExit?.(0)
    await waitFor(() => harness.messages.some(message => message.type === 'state' && message.running === false))
    expect(harness.exits).toEqual([])
    // The first death relaunches at once; the next ones wait out the backoff,
    // so a tray that keeps dying cannot respawn windows in a loop.
    harness.crashShell()
    harness.crashShell()
    harness.crashShell()
    harness.crashShell()
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 20) })
    expect(harness.exits).toEqual([])
    expect(harness.shells).toBe(2)
    harness.emit({ type: 'quit' })
    await done
    expect(harness.exits).toEqual([0])
  })

  it('restarts a running service from the tray', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    harness.emit({ type: 'restart' })
    await waitFor(() => harness.messages.filter(message => message.type === 'ready').length === 2)
    expect(harness.disposed).toEqual([1])
    expect(harness.windows).toHaveLength(2)
    expect(harness.bootArgs).toEqual([
      ['--host', '127.0.0.1', '--port', '3080', '--no-open'],
      ['--host', '127.0.0.1', '--port', '3080', '--no-open'],
    ])
    harness.emit({ type: 'quit' })
    await done
  })

  it('persists a listen address and restarts onto the new port', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    expect(harness.messages).toEqual(expect.arrayContaining([
      { type: 'listen', host: '127.0.0.1', port: 3080 },
    ]))
    harness.emit({ type: 'listen', host: '0.0.0.0', port: 8080 })
    await waitFor(() => harness.messages.filter(message => message.type === 'ready').length === 2)
    expect(harness.saved).toEqual([{ host: '0.0.0.0', port: 8080 }])
    expect(harness.bootArgs.at(-1)).toEqual(['--host', '0.0.0.0', '--port', '8080', '--no-open'])
    expect(process.env.DSH_WEB_ALLOW_ALL_INTERFACES).toBe('1')
    harness.emit({ type: 'quit' })
    await done
    delete process.env.DSH_WEB_ALLOW_ALL_INTERFACES
  })

  it('does not spawn another window when a launcher hands off immediately', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    harness.windows[0]?.settle()
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 20) })
    harness.emit({ type: 'show' })
    await waitFor(() => harness.messages.some(message => message.type === 'focus'))
    expect(harness.windows).toHaveLength(1)
    harness.emit({ type: 'quit' })
    await done
  })

  it('focuses an already-open window on Show', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    harness.emit({ type: 'show' })
    await waitFor(() => harness.messages.some(message => message.type === 'focus'))
    expect(harness.windows).toHaveLength(1)
    harness.emit({ type: 'quit' })
    await done
  })

  it('reopens the main window when Show focus finds no visible HWND', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    harness.emit({ type: 'show' })
    await waitFor(() => harness.messages.some(message => message.type === 'focus'))
    expect(harness.windows).toHaveLength(1)
    harness.emit({ type: 'window-missing' })
    await waitFor(() => harness.windows.length === 2)
    expect(harness.windows[1]?.url).toBe('http://127.0.0.1:3080/?token=test-token')
    harness.emit({ type: 'window-missing' })
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 20) })
    expect(harness.windows).toHaveLength(2)
    harness.emit({ type: 'quit' })
    await done
  })

  it('ignores window-missing unless Show asked to raise a tracked window', async () => {
    const harness = createHarness()
    const done = runPackagedWebDesktop(harness.io)
    await waitFor(() => harness.messages.some(message => message.type === 'ready'))
    harness.emit({ type: 'window-missing' })
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 20) })
    expect(harness.windows).toHaveLength(1)
    harness.emit({ type: 'quit' })
    await done
  })
})
