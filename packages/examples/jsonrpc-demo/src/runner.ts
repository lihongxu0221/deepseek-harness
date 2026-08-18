/**
 * Shared process lifecycle for the generic and closed-runtime JSON-RPC bins.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-demo/runner
 */

import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isSea } from 'node:sea'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import {
  JSONRPC_AGENT_NAME,
  isPackagedJsonrpcExecutable,
  resolveJsonrpcAgentConfig,
} from './config-path.ts'

/* v8 ignore start -- composition over tested config-path/app-boot/jsonrpc and executable acceptance paths */

/**
 * Boot the selected external configuration and own process exit.
 * Packaged executables with no env or argv path write and boot
 * `<executable-dir>/cordis.yml`; unpackaged launches still require a path.
 * @param bareModuleBaseUrl - optional installed-runtime base for bare plugins;
 * omit it when the configuration project owns its plugin packages.
 * @returns after process handlers are installed; process lifetime then belongs
 * to stdin and signal events.
 */
export async function runJsonrpcAgent(bareModuleBaseUrl?: string): Promise<void> {
  installFailLoud(JSONRPC_AGENT_NAME)
  loadEnv(JSONRPC_AGENT_NAME)

  const execDir = dirname(process.execPath)
  const packaged = isPackagedJsonrpcExecutable(process.execPath, isSea())
  if (packaged) loadEnv(JSONRPC_AGENT_NAME, execDir)

  const resolved = resolveJsonrpcAgentConfig({
    envPath: process.env['DSH_CORDIS_CONFIG'],
    argvPath: process.argv[2],
    packaged,
    execDir,
    exists: existsSync,
    writeFile: (path, contents) => {
      const tmp = `${path}.tmp`
      writeFileSync(tmp, contents, 'utf8')
      renameSync(tmp, path)
    },
    warn: (line) => { process.stderr.write(line) },
    getEnv: name => process.env[name],
    setEnv: (name, value) => { process.env[name] = value },
  })
  if (resolved.status === 'missing') {
    process.stderr.write(resolved.usage)
    process.exit(1)
  }

  const ctx = await boot(JSONRPC_AGENT_NAME, resolveConfigPath(resolved.path, undefined), undefined, undefined, bareModuleBaseUrl)
  if (process.stdin.isTTY === true) {
    process.stderr.write(`${JSONRPC_AGENT_NAME}: ready; waiting for JSON-RPC on stdin. This is a server, not a chat. Ctrl+C to exit.\n`)
  }
  let exiting = false

  async function disposeAndExit(code: number): Promise<void> {
    if (exiting) return
    exiting = true
    try {
      await ctx.fiber.dispose()
    } finally {
      process.exit(code)
    }
  }

  process.stdin.on('end', () => { void disposeAndExit(0) })
  process.on('SIGTERM', () => { void disposeAndExit(0) })
  process.on('SIGINT', () => { void disposeAndExit(130) })
}
/* v8 ignore stop */
