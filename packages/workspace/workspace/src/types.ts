/**
 * Public type vocabulary of the workspace entity: the `WorkspaceId` brand and
 * the `Workspace` consumer interface. Types only — the `WorkspaceId` factory
 * lives in `index.ts` (this file carries no runtime code).
 * @module @deepseek-ai/dsh-workspace/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
export type WorkspaceId = Branded<'WorkspaceId'>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No registration carries that Workspace identity. */
    'workspace/not-found': { readonly workspaceId: WorkspaceId }
  }
}

/**
 * One workspace: a stable id over an existing primary directory, optional
 * extra folders, a display title, and an ordered candidate account of
 * sessions. Membership requires both an id in that account and a session
 * header whose canonical cwd equals the primary path or one extra folder;
 * because an extra folder may be shared, the account — not the cwd — decides
 * which workspace owns a session.
 * Consumers only see this interface; the implementation stays private.
 */
export interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical primary directory: the `fs.realpath` of the path given at
   * create time (trailing slashes, `..`, and symlinks all resolved). New
   * sessions use this as cwd, so agent instructions (`AGENTS.md` and the
   * rest of the instruction walk) start here. {@link setPrimaryFolder}
   * rewrites it among owned directories; a missing directory never rewrites
   * it (see {@link status}).
   */
  readonly path: string

  /**
   * Extra canonical directories this workspace also owns. A path may be an
   * extra folder of several workspaces and may also be another workspace's
   * primary; only {@link path} is unique across the registry. Does not include
   * {@link path}.
   */
  readonly folders: readonly string[]

  /** Display title. Defaults to the final path segment, or a filesystem root's own spelling; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Add an extra directory to this workspace. The path is canonicalized
   * through `fs.realpath`; a nonexistent or non-directory path rejects. A
   * path this workspace already owns resolves without writing. A path another
   * workspace owns — as its extra folder or as its primary — is accepted.
   * Extra folders expand session membership and workspace-write roots; they
   * do not change {@link path}. The first folder added to a workspace is the
   * primary from create; later extras stay extras until {@link setPrimaryFolder}.
   * @param path - Existing directory to own, in any path spelling.
   * @returns resolution after durability.
   */
  addFolder(path: string): Promise<void>

  /**
   * Remove an extra directory from this workspace. Removing {@link path}
   * rejects. An unknown extra folder resolves without writing. The directory
   * itself is never deleted.
   * @param path - Extra folder to drop, in any path spelling.
   * @returns resolution after durability.
   */
  removeFolder(path: string): Promise<void>

  /**
   * Make an owned extra folder the primary directory (new-session cwd).
   * The previous primary becomes an extra folder. Naming {@link path} is a
   * no-op success. An unknown path rejects, and so does a path that is
   * already another workspace's primary. Existing session header cwds
   * stay unchanged.
   * @param path - Owned extra folder to promote, in any path spelling.
   * @returns resolution after durability.
   */
  setPrimaryFolder(path: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path}
   * or one extra folder; unknown ids, missing or invalid cwd values, and
   * mismatches reject without writing. A session another workspace already
   * accounts also rejects.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
