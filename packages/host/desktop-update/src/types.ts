/** Public types for the packaged-desktop GitHub zip updater. */

/** Lifecycle reported to the browser half. */
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
  /** Expected total bytes (Content-Length or the GitHub asset size). */
  readonly total: number
}

/** Snapshot served by `/api/desktop-update/status` and `/progress`. */
export interface DesktopUpdateStatus {
  /** Current updater lifecycle. */
  readonly mode: DesktopUpdateMode
  /** VERSION stamp beside the packaged launcher, when packaged. */
  readonly current?: string
  /** Highest GitHub zip version, when a check has succeeded. */
  readonly latest?: string
  /** True when `latest` is strictly newer than `current`. */
  readonly outdated: boolean
  /** Release body for `latest`, when GitHub supplied one. */
  readonly notes?: string
  /** Whole-check or whole-run failure. */
  readonly error?: string
  /** Download progress while `mode` is `downloading`. */
  readonly progress?: DesktopUpdateProgress
  /** GitHub asset filename for `latest`. */
  readonly assetName?: string
}

/** One GitHub release asset used for zip selection. */
export interface GitHubReleaseAsset {
  /** Asset filename. */
  readonly name: string
  /** Browser download URL. */
  readonly browser_download_url: string
  /** Declared size in bytes. */
  readonly size: number
  /** GitHub digest, `sha256:` plus 64 hex digits, when present. */
  readonly digest?: string
}

/** One GitHub Releases API row. */
export interface GitHubRelease {
  /** Tag name, often `winexe-<version>`. */
  readonly tag_name: string
  /** Whether GitHub marked the release as a prerelease. */
  readonly prerelease: boolean
  /** Whether the release is still a draft. */
  readonly draft: boolean
  /** Markdown body, when present. */
  readonly body?: string | null
  /** Attached files. */
  readonly assets: readonly GitHubReleaseAsset[]
}

/** Parsed `{semver}.winexe.{n}` product stamp. */
export interface WinexeVersion {
  /** Stamp without a leading `winexe-` tag prefix. */
  readonly raw: string
  /** Semver portion before `.winexe.{n}`. */
  readonly base: string
  /** Winexe iteration; `0` when the stamp has no `.winexe.{n}` suffix. */
  readonly iter: number
}

/** Newest zip strictly newer than the installed stamp, when one exists. */
export interface SelectedRelease {
  /** Product stamp taken from the asset filename. */
  readonly version: string
  /** GitHub tag name. */
  readonly tag: string
  /** Asset filename. */
  readonly assetName: string
  /** Browser download URL. */
  readonly downloadUrl: string
  /** Declared size in bytes. */
  readonly size: number
  /** GitHub digest, when present. */
  readonly digest?: string
  /** Release body, when present. */
  readonly notes?: string
}
