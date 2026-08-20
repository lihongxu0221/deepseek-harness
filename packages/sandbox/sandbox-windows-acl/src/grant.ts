/**
 * Server-side write-grant materialization. The sandbox seam holds one
 * standing workspace grant per workspace and one revocable temp grant per
 * live session/workspace pair. Workspace identities survive by deterministic
 * derivation and their standing ACE; temp identities derive from random
 * private paths and are deliberately new after a restart.
 *
 * Fail-closed: `add` throws on any grant failure and the caller disposes the
 * instance (revoking every path granted so far); `revoke` drops one standing
 * extra-folder ACE when that folder leaves the workspace; `dispose` revokes
 * revocable paths and reports every cleanup failure.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/grant
 */

import { grantWrite, revokeWrite } from './acl.ts'
import { allocPtrSlot, decodePtr, isNullPtr, throwLastError, win32Sync } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'

/**
 * One write SID's provider-lifetime grant materialization: the parsed SID
 * pointer plus every directory whose DACL currently carries its ACE.
 * The primary workspace root is added STANDING (its ACE is the
 * cross-session reuse cache and outlives the grant — dispose() skips
 * revoking it). Extra folders are also added standing while owned, then
 * {@link AclWriteGrant.revoke} drops that ACE when the folder leaves.
 * Temp paths are revocable (dispose() revokes them — an inheritable ACE
 * must not outlive its session's temp directory). Create with
 * {@link AclWriteGrant.create}; dispose revokes the revocable paths and
 * frees the SID.
 */
export class AclWriteGrant {
  /** The write SID in SDDL string form. */
  readonly writeSid: string
  private readonly api: Win32Bindings
  private readonly sidPtr: NativePtr
  private readonly revocablePaths: string[] = []
  private readonly standingPaths: string[] = []

  private constructor(api: Win32Bindings, sidPtr: NativePtr, writeSid: string) {
    this.api = api
    this.sidPtr = sidPtr
    this.writeSid = writeSid
  }

  /**
   * Parse the SID string and open the binding table (lazily, once per
   * server). Fail-closed: any failure throws — nothing is granted yet.
   * @param writeSid - the workspace (`S-1-4-x-y`) or temp (`S-1-4-x-y-1`) capability SID string.
   * @param api - optional already-resolved bindings (tests).
   * @returns the ready grant (no ACEs yet).
   */
  static create(writeSid: string, api?: Win32Bindings): AclWriteGrant {
    const bindings = api ?? win32Sync()
    const sidSlot = allocPtrSlot()
    if (bindings.convertStringSidToSidW(writeSid, sidSlot) === 0) {
      throwLastError(bindings, 'ConvertStringSidToSidW', writeSid)
    }
    const sidPtr = decodePtr(sidSlot)
    if (sidPtr === null) throwLastError(bindings, 'ConvertStringSidToSidW', `null SID for ${writeSid}`)
    return new AclWriteGrant(bindings, sidPtr, writeSid)
  }

  /**
   * Grant the write ACE on one directory (idempotent: an already-standing
   * exact ACE skips the eager full-tree re-propagation — see
   * {@link grantWrite}) and record the path for {@link dispose} unless it is
   * standing. The path is recorded BEFORE the grant: a post-apply throw (a
   * LocalFree failure after SetNamedSecurityInfoW succeeded) must still
   * revoke it, and revoking an ungranted path is a no-op merge. Callers
   * treat a throw as a failed materialization and dispose the instance to
   * revoke the paths granted so far.
   * @param path - the directory whose DACL gains the grant.
   * @param standing - the ACE outlives {@link dispose} (the primary-root
   *   reuse cache, or an extra folder while the workspace owns it).
   *   {@link revoke} can still drop a standing extra-folder ACE. Default
   *   false (revoked on dispose — the temp-directory lifecycle).
   */
  add(path: string, standing = false): void {
    ;(standing ? this.standingPaths : this.revocablePaths).push(path)
    grantWrite(this.api, path, this.sidPtr)
  }

  /** Every directory currently carrying the grant, in grant order. */
  get paths(): readonly string[] {
    return [...this.standingPaths, ...this.revocablePaths]
  }

  /**
   * Remove the write ACE from one standing directory and drop it from this
   * grant. The sandbox seam calls this for an extra folder that left the
   * workspace; it never passes the primary root, which stays the reuse cache.
   * An unknown or revocable path is a no-op. Fail-closed: a revoke error
   * leaves the path recorded so a later call can retry.
   * @param path - standing directory that should lose the ACE.
   */
  revoke(path: string): void {
    if (!this.standingPaths.includes(path) || this.revocablePaths.includes(path)) return
    revokeWrite(this.api, path, this.sidPtr)
    this.standingPaths.splice(this.standingPaths.indexOf(path), 1)
  }

  /** Revoke every revocable grant (standing ACEs stay) and free the SID; reports every cleanup failure. */
  dispose(): void {
    const failures: unknown[] = []
    for (const path of this.revocablePaths) {
      try {
        revokeWrite(this.api, path, this.sidPtr)
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      const freed = this.api.localFree(this.sidPtr)
      if (!isNullPtr(freed)) throwLastError(this.api, 'LocalFree', 'write SID')
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `AclWriteGrant dispose completed with ${failures.length} cleanup failure(s)`)
    }
  }
}
