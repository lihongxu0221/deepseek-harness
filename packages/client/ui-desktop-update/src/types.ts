/** Browser-facing updater snapshot. Mirrors the Host JSON without importing it. */

/** Lifecycle reported by `/api/desktop-update/status`. */
export type DesktopUpdateMode =
  | 'unavailable'
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'applying'
  | 'error'

/** Byte progress of an in-flight zip download. */
export interface DesktopUpdateProgress {
  /** Bytes written so far. */
  readonly received: number
  /** Expected total bytes. */
  readonly total: number
}

/** Snapshot from the Host updater routes. */
export interface DesktopUpdateStatus {
  /** Current updater lifecycle. */
  readonly mode: DesktopUpdateMode
  /** Installed VERSION stamp. */
  readonly current?: string
  /** Newest GitHub zip stamp. */
  readonly latest?: string
  /** True when `latest` is strictly newer than `current`. */
  readonly outdated: boolean
  /** Release body for `latest`. */
  readonly notes?: string
  /** Whole-check or whole-run failure. */
  readonly error?: string
  /** Download progress while downloading. */
  readonly progress?: DesktopUpdateProgress
  /** GitHub asset filename for `latest`. */
  readonly assetName?: string
}

/** Settings-row store. */
export interface DesktopUpdateRowState {
  /** Latest Host snapshot. */
  status: DesktopUpdateStatus
  /** True after the first status probe settles. */
  loaded: boolean
}
