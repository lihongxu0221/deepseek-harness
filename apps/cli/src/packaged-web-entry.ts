/**
 * On-disk Web desktop entry beside the packaged launcher executable.
 * The launcher is a thin pkg SEA host; the CLI closure must stay on disk so
 * profile module fallback can symlink real packages. A first extra argument
 * that names an existing .js/.cjs/.mjs file is treated as a Node script so
 * a host that spawn()s this executable with a worker path behaves like node.
 * CLI heads such as `plugin` and `--profile` import on-disk `lib/bin.js`
 * instead of claiming the single-instance GUI lock.
 * @module @deepseek-ai/dsh/packaged-web-entry
 */

import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'

/** Deployed Web desktop entry, relative to the launcher executable. */
export const PACKAGED_WEB_ENTRY_REL = join('lib', 'packaged-web-bin.js')

/** Deployed CLI entry, relative to the launcher executable. */
export const PACKAGED_WEB_CLI_REL = join('lib', 'bin.js')

/** Extra argv heads that must run `lib/bin.js` instead of the desktop lock. */
export const PACKAGED_WEB_CLI_HEADS = new Set([
  'plugin',
  '--help',
  '-h',
  '--version',
  '-V',
  '--dump-config',
  '--dump-default-config',
  '--profile',
])

const MISSING_PACKAGED_FILE =
  'Keep this executable inside the built folder; do not copy the .exe alone.'

/** Script extensions a packaged host may import instead of the GUI entry. */
const PACKAGED_WEB_SCRIPT_EXTS = new Set(['.js', '.cjs', '.mjs'])

/** Launcher filenames that occupy argv[1] and must not be treated as scripts. */
const PACKAGED_WEB_LAUNCHER_BASENAMES = new Set([
  'packaged-web-launcher.cjs',
  'packaged-web-bin.js',
])

/**
 * Compare two filesystem paths after resolving, case-insensitively on win32.
 * @param left - first path.
 * @param right - second path.
 * @returns whether both resolve to the same path.
 */
function sameResolvedPath(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Resolve the on-disk Web desktop entry beside the launcher executable.
 * @param execPath - `process.execPath` of the launcher.
 * @param exists - replaceable existence check.
 * @returns the absolute entry path.
 */
export function resolvePackagedWebEntry(
  execPath: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const entry = join(dirname(execPath), PACKAGED_WEB_ENTRY_REL)
  if (!exists(entry)) {
    throw new Error(`dsh-web: missing ${entry}. ${MISSING_PACKAGED_FILE}`)
  }
  return entry
}

/**
 * Resolve the on-disk CLI entry beside the launcher executable.
 * @param execPath - `process.execPath` of the launcher.
 * @param exists - replaceable existence check.
 * @returns the absolute CLI entry path.
 */
export function resolvePackagedCliEntry(
  execPath: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const entry = join(dirname(execPath), PACKAGED_WEB_CLI_REL)
  if (!exists(entry)) {
    throw new Error(`dsh-web: missing ${entry}. ${MISSING_PACKAGED_FILE}`)
  }
  return entry
}

/**
 * Extra argv that is a CLI invocation, or `undefined` to keep the GUI.
 * The Plugin Market and `dsh plugin` spawn this same executable; `--profile`,
 * help, version, and config dumps would likewise take the guest path and exit 0.
 * Inner web flags such as `--port` still boot or focus the GUI.
 * @param args - extra argv after {@link extraPackagedArgv}.
 * @returns the CLI argv when the first token is a CLI head.
 */
export function packagedCliArgv(args: readonly string[]): string[] | undefined {
  const head = args[0]
  if (head === undefined || !PACKAGED_WEB_CLI_HEADS.has(head)) return undefined
  return [...args]
}

/**
 * Drop the Node/SEA program slot, a duplicated execPath (pkg sets argv[1] to
 * the exe), and the launcher file name so a script argument remains.
 * @param argv - `process.argv`.
 * @param launcherPath - path of the running launcher or on-disk entry.
 * @returns argv after the executable and launcher slots.
 */
export function extraPackagedArgv(argv: readonly string[], launcherPath: string): string[] {
  const execPath = argv[0]
  const rest = argv.slice(1)
  const skip = (value: string): boolean =>
    (execPath !== undefined && sameResolvedPath(value, execPath))
    || sameResolvedPath(value, launcherPath)
    || PACKAGED_WEB_LAUNCHER_BASENAMES.has(basename(value).toLowerCase())
  let index = 0
  while (index < rest.length && skip(rest[index] ?? '')) index += 1
  return rest.slice(index)
}

/**
 * Resolve a first extra argument that names an existing Node script.
 * Missing paths and non-script tokens are ignored so the GUI still boots.
 * @param args - extra argv after {@link extraPackagedArgv}.
 * @param exists - replaceable existence check.
 * @returns the absolute script path, or `undefined` to boot the GUI.
 */
export function resolvePackagedScriptArg(
  args: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const candidate = args[0]
  if (candidate === undefined) return undefined
  if (!PACKAGED_WEB_SCRIPT_EXTS.has(extname(candidate).toLowerCase())) return undefined
  if (!exists(candidate)) return undefined
  return resolve(candidate)
}
