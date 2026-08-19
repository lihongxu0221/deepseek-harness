/**
 * Persisted listen address for the packaged Windows Web desktop.
 * @module @deepseek-ai/dsh/desktop-listen
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Filename under `$DSH_HOME` for the packaged desktop listen address. */
export const DESKTOP_LISTEN_FILENAME = 'desktop-listen.json'

/** Loopback bind the packaged desktop uses unless the user chooses otherwise. */
export const DEFAULT_DESKTOP_LISTEN_HOST = '127.0.0.1'

/** Default listen port; matches the web profile fallback. */
export const DEFAULT_DESKTOP_LISTEN_PORT = 3080

/** Hosts the packaged desktop may bind. */
export const DESKTOP_LISTEN_HOSTS = [DEFAULT_DESKTOP_LISTEN_HOST, '0.0.0.0'] as const

/** One packaged-desktop listen address. */
export interface DesktopListen {
  /** Bind host: loopback or all interfaces. */
  host: (typeof DESKTOP_LISTEN_HOSTS)[number]
  /** Bind port; zero asks the OS for a free port. */
  port: number
}

const DEFAULT_LISTEN: DesktopListen = {
  host: DEFAULT_DESKTOP_LISTEN_HOST,
  port: DEFAULT_DESKTOP_LISTEN_PORT,
}

/**
 * Absolute path of the persist file.
 * @param home - resolved `$DSH_HOME`.
 * @returns `<home>/desktop-listen.json`.
 */
export function desktopListenPath(home: string): string {
  return join(home, DESKTOP_LISTEN_FILENAME)
}

/**
 * Accept only the two bind hosts the webserver schema already allows.
 * @param host - candidate host.
 * @returns the host, or `undefined` when it is not a packaged-desktop bind.
 */
export function parseDesktopListenHost(host: unknown): DesktopListen['host'] | undefined {
  if (host === DEFAULT_DESKTOP_LISTEN_HOST || host === '0.0.0.0') return host
  return undefined
}

/**
 * Accept a TCP port, including 0 for an OS-assigned port.
 * @param port - candidate port.
 * @returns the port, or `undefined` when it is out of range.
 */
export function parseDesktopListenPort(port: unknown): number | undefined {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) return undefined
  return port
}

/**
 * Validate a listen object from disk or the tray dialog.
 * @param value - parsed JSON or tray payload.
 * @returns the listen address, or `undefined` when either field is invalid.
 */
export function parseDesktopListen(value: unknown): DesktopListen | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as { host?: unknown; port?: unknown }
  const host = parseDesktopListenHost(record.host)
  const port = parseDesktopListenPort(record.port)
  if (host === undefined || port === undefined) return undefined
  return { host, port }
}

/**
 * Read the persist file, or the default listen when it is missing or invalid.
 * @param home - resolved `$DSH_HOME`.
 * @returns a usable listen address.
 */
export function loadDesktopListen(home: string): DesktopListen {
  let text: string
  try {
    text = readFileSync(desktopListenPath(home), 'utf8')
  } catch {
    return { ...DEFAULT_LISTEN }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ...DEFAULT_LISTEN }
  }
  return parseDesktopListen(parsed) ?? { ...DEFAULT_LISTEN }
}

/**
 * Write the persist file. The parent directory must already exist.
 * @param home - resolved `$DSH_HOME`.
 * @param listen - address to store.
 */
export function saveDesktopListen(home: string, listen: DesktopListen): void {
  writeFileSync(desktopListenPath(home), `${JSON.stringify(listen, null, 2)}\n`, 'utf8')
}

/**
 * Flag pair the web profile reads as `ctx.webStartup`.
 * @param listen - persisted or default address.
 * @returns `--host` / `--port` argv.
 */
export function desktopListenArgs(listen: DesktopListen): string[] {
  return ['--host', listen.host, '--port', String(listen.port)]
}
