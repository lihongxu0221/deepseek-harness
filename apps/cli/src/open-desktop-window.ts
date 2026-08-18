/**
 * Open a local Web GUI URL in a dedicated Chromium app window when possible.
 * Explorer launches get a browser chrome-free window; the packaged exe remains
 * the server and owns process lifetime.
 * @module @deepseek-ai/dsh/open-desktop-window
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** A spawned window process the launcher can wait on. */
export interface SpawnedDesktopWindow {
  /** Register a spawn-failure listener. */
  on(event: 'error', listener: (error: Error) => void): void
  /** Register an exit listener. `code` is null when the process is signaled. */
  on(event: 'exit', listener: (code: number | null) => void): void
}

/** Replaceable filesystem and process effects for {@link openDesktopWindow}. */
export interface DesktopWindowIo {
  /** Host platform; Windows prefers Edge/Chrome app mode. */
  platform: NodeJS.Platform
  /** Environment used to locate browsers and honor `DSH_WEB_BROWSER`. */
  env: NodeJS.ProcessEnv
  /** Dedicated Chromium user-data directory so the window is its own process. */
  userDataDir: string
  /**
   * Test whether a candidate browser path exists.
   * @param path - absolute candidate path.
   * @returns whether that file exists.
   */
  existsSync(path: string): boolean
  /**
   * Spawn a browser or OS opener. The caller does not detach waitable windows.
   * @param command - executable path or OS opener name.
   * @param args - arguments, already assembled.
   * @returns the spawned process.
   */
  spawn(command: string, args: readonly string[]): SpawnedDesktopWindow
}

/** A waitable desktop window. Closing it should stop the packaged server. */
export interface OpenedDesktopWindow {
  /** Resolves with the process exit code, or 0 when the OS reported a signal. */
  wait: Promise<number>
}

const LOOPBACK_HOST = '127.0.0.1'

/**
 * Accept only the loopback HTTP URL the packaged Web server prints.
 * @param url - candidate URL.
 * @returns the parsed URL.
 */
export function parseLocalWebUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`dsh-web: refusing to open ${JSON.stringify(url)}`)
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== LOOPBACK_HOST || parsed.port === '') {
    throw new Error(`dsh-web: refusing to open ${JSON.stringify(url)}`)
  }
  return parsed
}

/**
 * Default I/O: real process environment, the resolved harness home's
 * `desktop-chromium` directory as the app-mode profile, and `child_process.spawn`.
 * @returns the production I/O bag.
 */
export function defaultDesktopWindowIo(): DesktopWindowIo {
  return {
    platform: process.platform,
    env: process.env,
    userDataDir: join(resolveDshHome(), 'desktop-chromium'),
    existsSync,
    spawn: (command, args) => spawn(command, [...args], { stdio: 'ignore' }),
  }
}

/**
 * Resolve a Chromium-family browser that accepts `--app`.
 * @param io - filesystem and environment.
 * @returns an absolute browser path, or `undefined` when none exist.
 */
export function resolveChromiumAppBrowser(io: DesktopWindowIo): string | undefined {
  const programFiles = io.env.PROGRAMFILES ?? 'C:\\Program Files'
  const programFilesX86 = io.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = io.env.LOCALAPPDATA ?? ''
  const candidates = [
    io.env.DSH_WEB_BROWSER,
    join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]
  return candidates.find(path => path !== undefined && path !== '' && io.existsSync(path))
}

function waitForWindow(child: SpawnedDesktopWindow): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => { resolvePromise(code ?? 0) })
  })
}

/**
 * Open `url` in a dedicated app-mode window on Windows, or the OS opener
 * elsewhere. App-mode windows are waitable; `start`/`open`/`xdg-open` are not,
 * because those helpers exit immediately.
 * @param url - loopback HTTP URL printed by the Web server.
 * @param io - replaceable I/O; production uses {@link defaultDesktopWindowIo}.
 * @returns a waitable window, or `undefined` when only a fire-and-forget opener ran.
 */
export function openDesktopWindow(url: string, io: DesktopWindowIo = defaultDesktopWindowIo()): OpenedDesktopWindow | undefined {
  parseLocalWebUrl(url)
  if (io.platform === 'win32') {
    const browser = resolveChromiumAppBrowser(io)
    if (browser !== undefined) {
      const child = io.spawn(browser, [
        `--app=${url}`,
        `--user-data-dir=${io.userDataDir}`,
        '--window-size=1400,900',
        '--no-first-run',
        '--no-default-browser-check',
      ])
      return { wait: waitForWindow(child) }
    }
    io.spawn('cmd.exe', ['/c', 'start', '', url])
    return undefined
  }
  io.spawn(io.platform === 'darwin' ? 'open' : 'xdg-open', [url])
  return undefined
}
