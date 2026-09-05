/** Browser controller: Host snapshots into a settings-row store. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopUpdateRowState, DesktopUpdateStatus } from '../types.ts'
import { callUpdate } from './api.ts'

const INITIAL: DesktopUpdateStatus = { mode: 'unavailable', outdated: false }

/**
 * Owns polling and mutations for the General-settings updater row.
 */
export class DesktopUpdateClient {
  /** Row snapshot store. */
  readonly store = createSnapshotStore<DesktopUpdateRowState>({
    status: INITIAL,
    loaded: false,
  })

  private disposed = false
  private poll: ReturnType<typeof setInterval> | undefined

  /**
   * @param request - replaceable Fetch.
   */
  constructor(private readonly request: typeof fetch = fetch) {}

  /** Stop progress polling. */
  dispose(): void {
    this.disposed = true
    this.stopPoll()
  }

  /**
   * Probe current status once.
   * @returns the snapshot.
   */
  async refresh(): Promise<DesktopUpdateStatus> {
    return this.run(() => callUpdate('/status', 'GET', this.request))
  }

  /**
   * Force a GitHub check.
   * @returns the snapshot.
   */
  async check(): Promise<DesktopUpdateStatus> {
    return this.run(() => callUpdate('/check', 'POST', this.request))
  }

  /**
   * Start a zip download and poll progress until it leaves `downloading`.
   * @returns the snapshot.
   */
  async download(): Promise<DesktopUpdateStatus> {
    const status = await this.run(() => callUpdate('/download', 'POST', this.request))
    if (status.mode === 'downloading') this.startPoll()
    return status
  }

  /**
   * Arm the apply helper. The Host process then exits; a failed Fetch after
   * that is ignored.
   * @returns the snapshot, or the last known snapshot when the Host is gone.
   */
  async apply(): Promise<DesktopUpdateStatus> {
    try {
      return await this.run(() => callUpdate('/apply', 'POST', this.request))
    } catch {
      const status = { ...this.store.getSnapshot().status, mode: 'applying' as const }
      this.store.update((draft) => { draft.status = status })
      return status
    }
  }

  private startPoll(): void {
    this.stopPoll()
    this.poll = setInterval(() => {
      void this.run(() => callUpdate('/progress', 'GET', this.request)).then((status) => {
        if (status.mode !== 'downloading') this.stopPoll()
      }).catch(() => { this.stopPoll() })
    }, 500)
  }

  private stopPoll(): void {
    if (this.poll === undefined) return
    clearInterval(this.poll)
    this.poll = undefined
  }

  private async run(op: () => Promise<DesktopUpdateStatus>): Promise<DesktopUpdateStatus> {
    try {
      const status = await op()
      if (this.disposed) return status
      this.store.update((draft) => {
        draft.status = status
        draft.loaded = true
      })
      return status
    } catch (error) {
      if (this.disposed) throw error
      this.store.update((draft) => {
        draft.status = {
          mode: 'error',
          outdated: false,
          error: error instanceof Error ? error.message : String(error),
        }
        draft.loaded = true
      })
      throw error
    }
  }
}
