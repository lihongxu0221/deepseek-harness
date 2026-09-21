/** Select source or built bootstrap assets in the mounted execution world. */
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { FileSystem } from '@deepseek-ai/dsh-fs'

/** Deployment-owned Node executable and optional preinstalled built bootstrap. */
export interface LaunchConfig {
  /** Executable in the subprocess world; defaults to the current Node executable. */
  nodeExecutable?: string
  /** Absolute preinstalled built bootstrap in the execution world. */
  bootstrapPath?: string
}

/**
 * Whether this host is a packaged `dsh` / `dsh-web` executable.
 * SEA builds may omit `process.pkg`; the stem matches
 * `isPackagedLauncher` in subprocess-local.
 * @param execPath - candidate executable; defaults to `process.execPath`.
 * @returns true when PTC must set `DSH_PTC_RUNTIME_NODE` instead of GUI argv.
 */
export function isPackagedPtcHost(execPath: string = process.execPath): boolean {
  if ('pkg' in process) return true
  const stem = basename(execPath).toLowerCase().replace(/\.exe$/u, '')
  return stem === 'dsh' || stem === 'dsh-web'
}

/**
 * Select explicit arguments without inheriting host loader or inspector flags.
 * @param fs - Filesystem mapping host bootstrap assets into the process world.
 * @param config - Optional preinstalled built bootstrap.
 * @param maxMessageBytes - Validated frame and queued-write limit.
 * @returns Arguments following the resolved Node executable.
 */
export function bootstrapArgs(fs: FileSystem, config: LaunchConfig, maxMessageBytes: number): string[] {
  if (config.bootstrapPath !== undefined) return [config.bootstrapPath, String(maxMessageBytes)]
  if (isPackagedPtcHost()) return [String(maxMessageBytes)]
  const mapped = (path: string): string => {
    const result = fs.processPathFromHostPath(path)
    if (result === undefined) throw new Error(`PTC runtime bootstrap is unavailable in the subprocess execution world: ${path}`)
    return result
  }
  /* v8 ignore next 3 -- built-lib.e2e.ts executes the bundled provider and sibling process.js under plain Node. */
  if (!new URL(import.meta.url).pathname.endsWith('.ts')) {
    return [mapped(fileURLToPath(new URL('./process.js', import.meta.url))), String(maxMessageBytes)]
  }
  const entry = mapped(fileURLToPath(new URL('./process.ts', import.meta.url)))
  const subprocess = dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-subprocess/package.json')))
  const helper = mapped(resolve(subprocess, 'src/control.ts'))
  const source = `const {openInheritedControlChannel}=await import(${JSON.stringify(pathToFileURL(helper).href)});const {runNodeMain}=await import(${JSON.stringify(pathToFileURL(entry).href)});await runNodeMain(openInheritedControlChannel(),${maxMessageBytes},process);`
  return ['--input-type=module', '--eval', source]
}
