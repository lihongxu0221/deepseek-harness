/**
 * Path-set helpers for a workspace record: the primary directory plus extra
 * folders. Membership, uniqueness, and sandbox extra-root projection all
 * share this list.
 * @module @deepseek-ai/dsh-workspace/src/folders
 */

/** The durable fields that identify a workspace's directories. */
export interface WorkspaceFolderRecord {
  /** Primary directory (new-session cwd). */
  readonly path: string
  /** Extra directories besides {@link path}. */
  readonly folders?: readonly string[]
}

/**
 * Extra folders only (never includes the primary path).
 * @param record - workspace record or view.
 * @returns the extra folder list, empty when the field is absent.
 */
export function extraFolders(record: WorkspaceFolderRecord): readonly string[] {
  return record.folders ?? []
}

/**
 * Every directory this workspace owns: primary first, then extras.
 * @param record - workspace record or view.
 * @returns the owned path list.
 */
export function ownedPaths(record: WorkspaceFolderRecord): readonly string[] {
  return [record.path, ...extraFolders(record)]
}

/**
 * Whether a canonical path is this workspace's primary or an extra folder.
 * @param record - workspace record or view.
 * @param path - already-canonical directory path.
 * @returns true when the workspace owns the path.
 */
export function ownsPath(record: WorkspaceFolderRecord, path: string): boolean {
  return record.path === path || extraFolders(record).includes(path)
}
