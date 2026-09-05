/** Stable HTTP paths and work-directory names for the desktop updater. */

/** Authenticated Fetch routes on the shared `/api` channel. */
export const DESKTOP_UPDATE_PATHS = {
  status: '/api/desktop-update/status',
  check: '/api/desktop-update/check',
  download: '/api/desktop-update/download',
  progress: '/api/desktop-update/progress',
  apply: '/api/desktop-update/apply',
} as const

/** Directory under `$DSH_HOME` that holds the zip, extract tree, and helper. */
export const WORK_DIR_NAME = 'desktop-update'

/** Downloaded zip filename inside the work directory. */
export const DOWNLOAD_ZIP_NAME = 'download.zip'

/** Extract directory name inside the work directory. */
export const EXTRACT_DIR_NAME = 'extract'

/** Helper script filename. */
export const APPLY_SCRIPT_NAME = 'apply.ps1'
