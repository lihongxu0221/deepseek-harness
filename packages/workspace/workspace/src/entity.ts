/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @deepseek-ai/dsh-workspace/src/entity
 */

import { stat } from 'node:fs/promises'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId } from './types.ts'
import { extraFolders, ownsPath } from './folders.ts'
import { realpathNormalize } from './paths.ts'

/** setPrimaryFolder named a directory that is already another workspace's primary. */
export class WorkspaceFolderConflictError extends Error {
  /**
   * @param path - Canonical directory that is already another workspace's primary.
   * @param ownerId - Workspace that already holds the path as its primary.
   */
  constructor(readonly path: string, readonly ownerId: WorkspaceId) {
    super(`cannot set primary folder '${path}': it is already the primary directory of workspace '${ownerId}'`)
    this.name = 'WorkspaceFolderConflictError'
  }
}

/** setPrimaryFolder named a path this workspace does not own. */
export class WorkspaceFolderUnknownError extends Error {
  /**
   * @param path - Canonical (or stored) directory the caller tried to promote.
   */
  constructor(readonly path: string) {
    super(`cannot set primary folder '${path}': it is not owned by this workspace`)
    this.name = 'WorkspaceFolderUnknownError'
  }
}

/** removeFolder named the workspace primary directory. */
export class WorkspaceFolderPrimaryError extends Error {
  /**
   * @param path - Canonical primary directory the caller tried to remove.
   */
  constructor(readonly path: string) {
    super(`cannot remove folder '${path}': it is the workspace primary directory`)
    this.name = 'WorkspaceFolderPrimaryError'
  }
}

/** attachSession named a session another workspace already accounts. */
export class WorkspaceSessionAccountedError extends Error {
  /**
   * @param sessionId - Session that is already accounted elsewhere.
   * @param ownerId - Workspace whose durable account holds the session.
   */
  constructor(readonly sessionId: SessionId, readonly ownerId: WorkspaceId) {
    super(`cannot attach session '${sessionId}': already accounted by workspace '${ownerId}'`)
    this.name = 'WorkspaceSessionAccountedError'
  }
}

/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export class WorkspaceMoveInvalidError extends Error {
  /**
   * @param message - Which id was unaccounted and where.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceMoveInvalidError'
  }
}

/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the open table, the canonical session-path
 * index backing the `sessionIds` projection, and attach-time header reads.
 */
export interface WorkspaceEntityHost {
  /**
   * Resolve the open `workspaces` table.
   * @returns the table; throws while the registry has not started yet.
   */
  table(): KvTable<WorkspaceId, WorkspaceRecord>

  /**
   * Read a session's canonical directory from the registry's header index.
   * @param id - Session whose indexed path is requested.
   * @returns the canonical directory, or `undefined` when the header is
   * missing or its cwd cannot identify an existing directory.
   */
  sessionPath(id: SessionId): string | undefined

  /**
   * Read one stored session header for attach validation.
   * @param id - The session whose header to read.
   * @returns the header; rejects when session persistence is absent or holds
   * no session with this id.
   */
  readSessionHeader(id: SessionId): Promise<SessionHeader>

  /**
   * Publish a successfully validated canonical cwd to the projection index.
   * @param id - Validated session id.
   * @param path - Canonical existing directory from the immutable header cwd.
   */
  rememberSessionPath(id: SessionId, path: string): void

  /**
   * Reject when another workspace already holds this canonical directory as
   * its PRIMARY. Extra folders are shareable, so only a primary claim conflicts.
   * @param owner - Workspace that wants to hold the path as its primary.
   * @param canonical - Already-canonical directory path.
   */
  assertFolderAvailable(owner: WorkspaceId, canonical: string): void

  /**
   * Reject when another workspace's durable account already holds this session.
   * @param owner - Workspace that wants to account the session.
   * @param sessionId - Session about to be attached.
   */
  assertSessionUnaccounted(owner: WorkspaceId, sessionId: SessionId): void

  /**
   * Run `operation` on the registry write queue. Primary claims and session
   * accounting are cross-workspace checks and must not interleave with
   * create/delete or another folder mutation. Must not be called from another
   * queued registry operation: the queue is not reentrant.
   * @param operation - Work that claims or drops a folder.
   * @returns the operation result.
   */
  enqueue<T>(operation: () => Promise<T>): Promise<T>
}

/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('workspace record unchanged (internal sentinel)')

/** The single {@link Workspace} implementation; constructed only by the registry. */
export class WorkspaceEntity implements Workspace {
  private record: WorkspaceRecord

  /**
   * @param host - Registry-owned table, session-path index, and header reads.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   */
  constructor(
    private readonly host: WorkspaceEntityHost,
    readonly id: WorkspaceId,
    record: WorkspaceRecord,
  ) {
    this.record = record
  }

  get path(): string {
    return this.record.path
  }

  get folders(): readonly string[] {
    return extraFolders(this.record)
  }

  get title(): string {
    return this.record.title
  }

  get createdAt(): string {
    return this.record.createdAt
  }

  get updatedAt(): string {
    return this.record.updatedAt
  }

  get sessionIds(): readonly SessionId[] {
    return this.record.sessionIds.filter((id) => {
      const path = this.host.sessionPath(id)
      return path !== undefined && ownsPath(this.record, path)
    })
  }

  async setTitle(title: string): Promise<void> {
    await this.mutate(record => ({ ...record, title }))
  }

  async addFolder(path: string): Promise<void> {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot add folder '${canonical}' to workspace '${this.record.path}': path is not a directory`)
    }
    await this.host.enqueue(async () => {
      if (ownsPath(this.record, canonical)) return
      await this.mutate((record) => {
        if (ownsPath(record, canonical)) return record
        return { ...record, folders: [...extraFolders(record), canonical] }
      })
    })
  }

  async removeFolder(path: string): Promise<void> {
    let canonical: string
    try {
      canonical = await realpathNormalize(path)
    } catch {
      // The extra folder may already be missing; match the stored spelling.
      canonical = path
    }
    await this.host.enqueue(async () => {
      if (canonical === this.record.path) throw new WorkspaceFolderPrimaryError(canonical)
      await this.mutate((record) => {
        const folders = extraFolders(record)
        if (!folders.includes(canonical) && !folders.includes(path)) return record
        return {
          ...record,
          folders: folders.filter(folder => folder !== canonical && folder !== path),
        }
      })
    })
  }

  async setPrimaryFolder(path: string): Promise<void> {
    let canonical: string
    try {
      canonical = await realpathNormalize(path)
    } catch {
      // The extra folder may already be missing; match the stored spelling.
      canonical = path
    }
    await this.host.enqueue(async () => {
      if (canonical === this.record.path || path === this.record.path) return
      const folders = extraFolders(this.record)
      if (!folders.includes(canonical) && !folders.includes(path)) {
        throw new WorkspaceFolderUnknownError(canonical)
      }
      this.host.assertFolderAvailable(this.id, folders.includes(canonical) ? canonical : path)
      await this.mutate((record) => {
        if (canonical === record.path || path === record.path) return record
        const extras = extraFolders(record)
        const match = extras.includes(canonical) ? canonical : extras.includes(path) ? path : undefined
        if (match === undefined) throw new WorkspaceFolderUnknownError(canonical)
        return {
          ...record,
          path: match,
          folders: [record.path, ...extras.filter(folder => folder !== match)],
        }
      })
    })
  }

  async attachSession(sessionId: SessionId): Promise<void> {
    // Validation is skipped when the settled snapshot already accounts the
    // id: the cwd fact was checked when it first attached and both inputs
    // (stored header cwd, workspace path) are immutable. Membership itself is
    // decided on the write chain inside `mutate`, never on this snapshot.
    if (!this.record.sessionIds.includes(sessionId)) {
      const header = await this.host.readSessionHeader(sessionId)
      if (header.cwd === undefined) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + 'its stored header carries no cwd to validate against',
        )
      }
      let cwd: string
      try {
        cwd = await realpathNormalize(header.cwd)
      } catch (error) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd '${header.cwd}' does not resolve, so it cannot be validated`,
          { cause: error },
        )
      }
      if (!(await stat(cwd)).isDirectory()) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd '${header.cwd}' is not a directory`,
        )
      }
      if (!ownsPath(this.record, cwd)) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd resolves to '${cwd}'`,
        )
      }
      this.host.rememberSessionPath(sessionId, cwd)
    }
    await this.host.enqueue(async () => {
      if (!this.record.sessionIds.includes(sessionId)) {
        this.host.assertSessionUnaccounted(this.id, sessionId)
      }
      await this.mutate(record => record.sessionIds.includes(sessionId)
        ? record
        : { ...record, sessionIds: [sessionId, ...record.sessionIds] })
    })
  }

  async insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void> {
    await this.mutate((record) => {
      if (!record.sessionIds.includes(sessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' in workspace '${record.path}': the session is not accounted`,
        )
      }
      if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${record.path}': `
          + 'the anchor session is not accounted',
        )
      }
      if (beforeSessionId === sessionId) return record
      const without = record.sessionIds.filter(id => id !== sessionId)
      const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
      const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
      return sessionIds.every((id, index) => id === record.sessionIds[index])
        ? record
        : { ...record, sessionIds }
    })
  }

  async detachSession(sessionId: SessionId): Promise<void> {
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? { ...record, sessionIds: record.sessionIds.filter(id => id !== sessionId) }
      : record)
  }

  async status(): Promise<'ok' | 'missing-dir'> {
    try {
      return (await stat(this.record.path)).isDirectory() ? 'ok' : 'missing-dir'
    } catch {
      // Any stat failure (ENOENT, dangling parent, permission loss) means the
      // directory is not usable right now; the record itself never mutates.
      return 'missing-dir'
    }
  }

  /**
   * The single write path: run `fn` on the domain write chain via
   * `table.update`, stamping `updatedAt` and pruning candidates that no
   * longer pass the id-plus-canonical-cwd membership check, then swap the
   * snapshot.
   *
   * `fn` sees the value current at its chain slot, so membership decisions
   * (attach/detach idempotence) are race-free against queued writes; a fn
   * signalling no change by returning `current` verbatim aborts the slot
   * through the sentinel when pruning also finds nothing, so a no-op neither
   * rewrites the medium nor emits a change event.
   */
  private async mutate(fn: (record: WorkspaceRecord) => WorkspaceRecord): Promise<void> {
    let next: WorkspaceRecord
    try {
      next = await this.host.table().update(this.id, (current) => {
        const changed = fn(current)
        const sessionIds = changed.sessionIds.filter((id) => {
          const path = this.host.sessionPath(id)
          return path !== undefined && ownsPath(changed, path)
        })
        if (changed === current && sessionIds.length === current.sessionIds.length) {
          throw unchangedSentinel
        }
        return { ...changed, sessionIds, updatedAt: new Date().toISOString() }
      })
    } catch (error) {
      if (error === unchangedSentinel) return
      throw error
    }
    this.record = next
  }
}
