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

/**
 * Basenames a shell may type for this launcher. The product exe is `dsh-web`;
 * the Plugin Market's PATH fallback is `dsh`. Either token is an invocation
 * echo, never a CLI head or a script.
 */
const PACKAGED_WEB_INVOCATION_STEMS = new Set(['dsh', 'dsh-web'])

/** PATH token the Plugin Market's `dshArgv()` fallback spawns. */
export const PACKAGED_MARKET_CLI_NAME = 'dsh'

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
  return sameResolvedPathOn(left, right, process.platform)
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
 * Extension-less, lowercased basename of one argv token or executable path.
 * @param value - a path or typed token.
 * @returns the stem used for invocation-echo comparison.
 */
function invocationStem(value: string): string {
  return basename(value).toLowerCase().replace(/\.(?:exe)$/u, '')
}

/**
 * Whether a leading extra argv entry is the invocation echo. The SEA
 * normalizes argv[0] to the absolute executable path and moves the token as
 * typed — `dsh` from `cmd /c dsh …`, `dsh.exe`, or any absolute spelling —
 * into the next slot. An echo references or names the executable and is
 * never an argument, a script, or an option.
 * @param value - one leading argv entry after argv[0].
 * @param execPath - `process.execPath` of the packaged launcher.
 * @returns whether the entry is the preserved invocation token.
 */
function isInvocationEcho(value: string, execPath: string): boolean {
  if (value.startsWith('-')) return false
  if (sameResolvedPath(value, execPath)) return true
  const token = invocationStem(value)
  return token === invocationStem(execPath) || PACKAGED_WEB_INVOCATION_STEMS.has(token)
}

/**
 * Sibling filename the Plugin Market looks up on PATH.
 * @param platform - pkg target (`win`) or `process.platform` (`win32`).
 * @returns `dsh.exe` on Windows, `dsh` elsewhere.
 */
export function packagedMarketCliAliasName(platform: string): string {
  return platform === 'win' || platform === 'win32' ? `${PACKAGED_MARKET_CLI_NAME}.exe` : PACKAGED_MARKET_CLI_NAME
}

/**
 * Rewrite `process.argv` so in-process `dshArgv()` treats this GUI as a CLI
 * entry. The Plugin Market then spawn()s this executable with `lib/bin.js`
 * instead of `cmd /c dsh`, which would flash an empty console.
 * @param execPath - `process.execPath` of the packaged launcher.
 * @param argv - current `process.argv`.
 * @returns argv whose slot 1 is `lib/bin.js` beside the exe.
 */
export function withPackagedMarketCliArgv(execPath: string, argv: readonly string[]): string[] {
  const cliEntry = join(dirname(execPath), PACKAGED_WEB_CLI_REL)
  return [argv[0] ?? execPath, cliEntry, ...argv.slice(2)]
}

/**
 * Drop the Node/SEA program slot, the invocation echo the SEA preserves in
 * the next slot (the token as typed — `dsh`, `dsh.exe`, or any absolute
 * spelling of the executable), the launcher file name, and `lib/bin.js`
 * when the market spawn()s this executable as a CLI entry.
 * @param argv - `process.argv`.
 * @param launcherPath - path of the running launcher or on-disk entry.
 * @param execPath - `process.execPath`; injectable for tests.
 * @returns argv after the executable, echo, and launcher slots.
 */
export function extraPackagedArgv(
  argv: readonly string[],
  launcherPath: string,
  execPath: string = process.execPath,
): string[] {
  const invokedAs = argv[0]
  const rest = argv.slice(1)
  const cliEntry = join(dirname(execPath), PACKAGED_WEB_CLI_REL)
  const skip = (value: string): boolean =>
    (invokedAs !== undefined && sameResolvedPath(value, invokedAs))
    || isInvocationEcho(value, execPath)
    || sameResolvedPath(value, launcherPath)
    || sameResolvedPath(value, cliEntry)
    || PACKAGED_WEB_LAUNCHER_BASENAMES.has(basename(value).toLowerCase())
  let index = 0
  while (index < rest.length && skip(rest[index] ?? '')) index += 1
  return rest.slice(index)
}

/**
 * Put the packaged executable's directory at the front of `env.PATH` so
 * children that re-invoke `dsh` by name — the Plugin Market's
 * `cmd /c dsh plugin …` and restart replays — resolve this executable even
 * when the folder is not on the user's PATH. Windows only: the packaged
 * desktop ships as a win32 build. Idempotent per directory.
 * @param execPath - `process.execPath` of the packaged launcher.
 * @param env - environment to mutate in place (`process.env` in production).
 * @param platform - `process.platform`; non-win32 calls are no-ops.
 */
export function prependPackagedBinToPath(
  execPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return
  const dir = dirname(execPath)
  const entries = (env.PATH ?? '').split(';').filter(value => value !== '')
  const already = entries.some(value => sameResolvedPathOn(value, dir, platform))
  if (already) return
  env.PATH = [dir, ...entries].join(';')
}

/**
 * Compare two resolved paths for a given platform, case-insensitively on win32.
 * @param left - first path.
 * @param right - second path.
 * @param platform - platform deciding case sensitivity.
 * @returns whether both resolve to the same path.
 */
function sameResolvedPathOn(left: string, right: string, platform: NodeJS.Platform): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Inline source for hosts that spawn this executable as Node with
 * `nodeExecutable()`-style argv (`<exe> -e <source>`), such as the Plugin
 * Market's detached restart helper. The executable already imports arbitrary
 * script files passed as argv, so evaluating inline source adds no new
 * capability; without it the `-e` source is ignored and the process falls
 * through to the GUI guest path.
 * @param args - extra argv after {@link extraPackagedArgv}.
 * @returns the source string when the head is `-e`/`--eval` followed by it.
 */
export function packagedEvalSource(args: readonly string[]): string | undefined {
  const head = args[0]
  if (head !== '-e' && head !== '--eval') return undefined
  return args[1]
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

/**
 * Node-shaped argv for an imported worker script.
 * The SEA otherwise leaves the invocation echo in argv[1], so a worker that
 * reads `process.argv.slice(2)` would treat its own path as the first flag
 * (`windows-acl-run: unknown argument: …/runner.js`).
 * @param execPath - `process.execPath` of the packaged launcher.
 * @param script - resolved worker path (argv[1] under Node).
 * @param extra - extra argv after {@link extraPackagedArgv}; `extra[0]` is the script token.
 * @returns `[execPath, script, ...scriptArgs]`.
 */
export function withPackagedScriptArgv(
  execPath: string,
  script: string,
  extra: readonly string[],
): string[] {
  return [execPath, script, ...extra.slice(1)]
}
