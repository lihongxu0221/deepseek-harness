/** Detect the packaged product folder and decide which entries an apply may copy. */

import { dirname, join } from 'node:path'

/** Filename the packer writes beside the launcher. */
export const VERSION_FILENAME = 'VERSION'

/** User-data directory that an apply must never replace. */
export const CONFIG_DIRNAME = '.config'

/** Packaged launcher names an extract tree must contain (Windows first). */
export const PRODUCT_LAUNCHERS = ['dsh-web.exe', 'dsh-web'] as const

/** One detected packaged install. */
export interface PackagedProduct {
  /** Directory that contains the launcher and VERSION. */
  readonly productDir: string
  /** Trimmed VERSION stamp. */
  readonly version: string
}

/**
 * Read a VERSION stamp from a product directory.
 * @param productDir - directory that may contain VERSION.
 * @param readFile - returns file text, or `undefined` when missing/unreadable.
 * @returns the trimmed stamp, or `undefined`.
 */
export function readProductVersion(
  productDir: string,
  readFile: (path: string) => string | undefined,
): string | undefined {
  const text = readFile(join(productDir, VERSION_FILENAME))
  if (text === undefined) return undefined
  const version = text.trim()
  return version === '' ? undefined : version
}

/**
 * Detect a packaged desktop from the running executable path.
 * @param execPath - `process.execPath`.
 * @param exists - path existence check.
 * @param readFile - VERSION reader.
 * @param extraDirs - extra product-directory candidates (packaged web `cwd`).
 * @returns the product folder and stamp, or `undefined` when not packaged.
 */
export function detectPackagedProduct(
  execPath: string,
  exists: (path: string) => boolean,
  readFile: (path: string) => string | undefined,
  extraDirs: readonly string[] = [],
): PackagedProduct | undefined {
  const seen = new Set<string>()
  for (const productDir of [dirname(execPath), ...extraDirs]) {
    if (productDir === '' || seen.has(productDir)) continue
    seen.add(productDir)
    if (!exists(join(productDir, VERSION_FILENAME))) continue
    const version = readProductVersion(productDir, readFile)
    if (version === undefined) continue
    return { productDir, version }
  }
  return undefined
}

/**
 * Whether one extract/product directory entry may be copied during apply.
 * `.config` stays on the installed machine; `.` / `..` are never copied.
 * @param name - directory entry basename.
 * @returns true when the apply helper may copy the entry.
 */
export function shouldCopyProductEntry(name: string): boolean {
  return name !== CONFIG_DIRNAME && name !== '.' && name !== '..'
}

/**
 * Whether an extracted tree looks like a packaged desktop.
 * @param root - extract root (after peeling a single wrapping directory).
 * @param exists - path existence check.
 * @returns true when VERSION and a launcher are present.
 */
export function isPackagedExtract(root: string, exists: (path: string) => boolean): boolean {
  if (!exists(join(root, VERSION_FILENAME))) return false
  return PRODUCT_LAUNCHERS.some(name => exists(join(root, name)))
}
