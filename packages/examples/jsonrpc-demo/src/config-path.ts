/**
 * Config discovery for the JSON-RPC agent bins: env and argv win; a packaged
 * executable with neither channel writes and boots `<execDir>/cordis.yml`.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-demo/config-path
 */

import { basename, join, resolve } from 'node:path'
import { PACKAGED_DEFAULT_CORDIS_YML } from './default-cordis-yml.ts'

/** Process name used in usage and write diagnostics. */
export const JSONRPC_AGENT_NAME = 'dsh-jsonrpc-agent'

/** Basename of the packaged executable-directory config. */
export const SIDECAR_CONFIG_BASENAME = 'cordis.yml'

/**
 * Injected I/O for {@link resolveJsonrpcAgentConfig} so unit tests do not touch
 * `process` or the real filesystem.
 */
export interface JsonrpcAgentConfigIo {
  /** `$DSH_CORDIS_CONFIG`; empty is absent. */
  readonly envPath: string | undefined
  /** `argv[2]`; empty is absent. */
  readonly argvPath: string | undefined
  /** Whether this process is the packaged executable, not a Node carrier. */
  readonly packaged: boolean
  /** Directory of `process.execPath`. */
  readonly execDir: string
  /** Filesystem existence probe. */
  readonly exists: (path: string) => boolean
  /** Creates the executable-directory default when the sidecar is missing. */
  readonly writeFile: (path: string, contents: string) => void
  /** Diagnostic sink; callers write these lines to stderr. */
  readonly warn: (line: string) => void
  /** Reads a process environment value. */
  readonly getEnv: (name: string) => string | undefined
  /** Sets a process environment value. */
  readonly setEnv: (name: string, value: string) => void
}

/**
 * Result of JSON-RPC agent config discovery.
 * `missing` means the caller should print `usage` and exit 1.
 */
export type JsonrpcAgentConfigResolution =
  | { status: 'ok'; path: string }
  | { status: 'missing'; usage: string }

/**
 * One-line usage for launches that still require an explicit config.
 * @returns the stderr usage line, including the trailing newline.
 */
export function jsonrpcAgentUsage(): string {
  return `usage: ${JSONRPC_AGENT_NAME} <path/to/cordis.yml> (or set DSH_CORDIS_CONFIG=<path>, which wins); unpackaged launches require an explicit config\n`
}

/**
 * Whether this process is the packaged JSON-RPC executable.
 * `sea` is Node's SEA bit; the filename prefix covers pkg hosts that do not set it.
 * @param execPath - `process.execPath`.
 * @param sea - `isSea()` from `node:sea`.
 * @returns true for the packaged executable; false for `node` and the node carrier.
 */
export function isPackagedJsonrpcExecutable(execPath: string, sea: boolean): boolean {
  return sea || /^dsh-jsonrpc-agent-pkg/i.test(basename(execPath))
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

function applyPackagedSidecarLaunchDefaults(
  execDir: string,
  getEnv: (name: string) => string | undefined,
  setEnv: (name: string, value: string) => void,
): void {
  if (!isPresent(getEnv('DSH_CWD'))) setEnv('DSH_CWD', execDir)
  if (!isPresent(getEnv('DSH_SESSION_ROOT'))) setEnv('DSH_SESSION_ROOT', join(execDir, '.sessions'))
}

/**
 * Resolve the config path the JSON-RPC agent should boot.
 * `$DSH_CORDIS_CONFIG` wins over argv. A named path that does not exist is
 * `missing`. Unpackaged launches with no named path are `missing`. A packaged
 * executable with no named path uses `<execDir>/cordis.yml`, writes
 * {@link PACKAGED_DEFAULT_CORDIS_YML} when that file is absent, and sets unset
 * `DSH_CWD` / `DSH_SESSION_ROOT` to the executable directory.
 * @param io - process values and filesystem adapters.
 * @returns the absolute config path, or usage for a required missing config.
 * @throws when the packaged default cannot be written.
 */
export function resolveJsonrpcAgentConfig(io: JsonrpcAgentConfigIo): JsonrpcAgentConfigResolution {
  const requested = isPresent(io.envPath) ? io.envPath : isPresent(io.argvPath) ? io.argvPath : undefined
  if (requested !== undefined) {
    const path = resolve(requested)
    if (!io.exists(path)) return { status: 'missing', usage: jsonrpcAgentUsage() }
    return { status: 'ok', path }
  }
  if (!io.packaged) return { status: 'missing', usage: jsonrpcAgentUsage() }

  const path = resolve(io.execDir, SIDECAR_CONFIG_BASENAME)
  if (!io.exists(path)) {
    try {
      io.writeFile(path, PACKAGED_DEFAULT_CORDIS_YML)
    } catch (error) {
      throw new Error(`${JSONRPC_AGENT_NAME}: failed to write default config ${path}: ${String(error)}`)
    }
    io.warn(`${JSONRPC_AGENT_NAME}: wrote default config ${path}\n`)
  }
  applyPackagedSidecarLaunchDefaults(io.execDir, io.getEnv, io.setEnv)
  return { status: 'ok', path }
}
