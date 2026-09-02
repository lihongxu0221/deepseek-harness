/**
 * Keep the packaged Web executable's .config home across rebuilds that delete
 * the product or staging folder.
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** Directory name for the packaged executable's harness home, beside the exe. */
export const PACKAGED_WEB_HOME_DIR = '.config'

/** Installation trees recreated on launch; not user data. */
const OMITTED_HOME_SEGMENTS = new Set(['node_modules', '.dsh-module-fallback'])

/**
 * Copy a packaged `.config` tree, omitting `node_modules` and
 * `.dsh-module-fallback`. Those directories are installation junctions
 * recreated on launch; `fs.cp` would recreate them as privilege-gated
 * symlinks and fail with `EPERM` on Windows.
 * @param source - existing `.config` directory.
 * @param destination - directory that should receive the copy.
 */
async function copyPackagedWebHome(source: string, destination: string): Promise<void> {
  const home = resolve(source)
  const prefix = home + sep
  await cp(source, destination, {
    recursive: true,
    filter: (path) => {
      const resolved = resolve(path)
      const relative = resolved === home
        ? ''
        : resolved.startsWith(prefix)
          ? resolved.slice(prefix.length)
          : resolved
      return !relative.split(sep).some(segment => OMITTED_HOME_SEGMENTS.has(segment))
    },
  })
}

/**
 * Copy `<directory>/.config` aside before a rebuild deletes that tree.
 * Omits `node_modules` and `.dsh-module-fallback`, which launch heals.
 * @param directory - staging or product folder that may already contain user data.
 * @returns the temp folder holding `.config`, or `undefined` when none existed.
 */
export async function stashPackagedWebHome(directory: string): Promise<string | undefined> {
  const home = join(directory, PACKAGED_WEB_HOME_DIR)
  if (!existsSync(home)) return undefined
  const stashRoot = await mkdtemp(join(tmpdir(), 'dsh-web-config-'))
  await copyPackagedWebHome(home, join(stashRoot, PACKAGED_WEB_HOME_DIR))
  return stashRoot
}

/**
 * Put a stashed `.config` back after the destination tree was recreated.
 * Leaves the stash in place if the copy-back fails so the files can be recovered.
 * @param directory - staging or product folder that should receive `.config`.
 * @param stashRoot - return value of {@link stashPackagedWebHome}.
 */
export async function restorePackagedWebHome(
  directory: string,
  stashRoot: string | undefined,
): Promise<void> {
  if (stashRoot === undefined) return
  const source = join(stashRoot, PACKAGED_WEB_HOME_DIR)
  const destination = join(directory, PACKAGED_WEB_HOME_DIR)
  await mkdir(directory, { recursive: true })
  await rm(destination, { recursive: true, force: true })
  try {
    await copyPackagedWebHome(source, destination)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`build-web-exe: failed to restore ${destination} from ${source}: ${detail}`)
  }
  await rm(stashRoot, { recursive: true, force: true })
}

/**
 * Run `action` after stashing `.config`, then put that folder back even if
 * `action` throws.
 * @param directory - staging or product folder that `action` may delete.
 * @param action - the rebuild step that replaces that folder.
 * @returns the value returned by `action`.
 */
export async function withPreservedPackagedWebHome<T>(
  directory: string,
  action: () => Promise<T>,
): Promise<T> {
  const stashRoot = await stashPackagedWebHome(directory)
  if (stashRoot !== undefined) {
    console.log(`build-web-exe: preserving ${join(directory, PACKAGED_WEB_HOME_DIR)}`)
  }
  try {
    const result = await action()
    await restorePackagedWebHome(directory, stashRoot)
    return result
  } catch (error) {
    try {
      await restorePackagedWebHome(directory, stashRoot)
    } catch (restoreError) {
      const actionText = error instanceof Error ? error.message : String(error)
      const restoreText = restoreError instanceof Error ? restoreError.message : String(restoreError)
      throw new Error(`${actionText}; ${restoreText}`)
    }
    throw error
  }
}
