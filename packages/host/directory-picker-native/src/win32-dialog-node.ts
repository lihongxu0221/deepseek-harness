/**
 * Choose the Node executable that runs the built Win32 dialog worker.
 * Source-plane tests and `node` hosts keep `process.execPath`. A packaged
 * SEA exe is not `node`; an explicit `$NODE_BINARY` or `$npm_node_execpath`
 * can force a real node, otherwise the host executable is reused so a
 * script-aware launcher stays on the packaged ABI.
 * @module @deepseek-ai/dsh-host-directory-picker-native/win32-dialog-node
 */

import { existsSync } from 'node:fs'
import { basename } from 'node:path'

const NODE_BASENAMES = new Set(['node', 'node.exe'])
const NODE_ENV_KEYS = ['NODE_BINARY', 'npm_node_execpath'] as const

/**
 * Whether `execPath` is a Node binary rather than a packaged product exe.
 * @param execPath - candidate executable path.
 * @returns `true` when the basename is `node` or `node.exe`.
 */
export function isNodeExecutable(execPath: string): boolean {
  return NODE_BASENAMES.has(basename(execPath).toLowerCase())
}

/**
 * Resolve the executable that should spawn `lib/worker.cjs`.
 * @param execPath - `process.execPath` of the host.
 * @param env - environment that may name an override Node.
 * @param exists - replaceable existence check.
 * @returns `execPath` when it is already Node or no override exists.
 */
export function resolveDialogNodeExecutable(
  execPath: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  if (isNodeExecutable(execPath)) return execPath
  for (const key of NODE_ENV_KEYS) {
    const candidate = env[key]
    if (candidate !== undefined && candidate.length > 0 && exists(candidate) && isNodeExecutable(candidate)) {
      return candidate
    }
  }
  return execPath
}
