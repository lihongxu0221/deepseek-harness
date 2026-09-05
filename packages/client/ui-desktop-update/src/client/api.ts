/** Same-origin Fetch helpers for `/api/desktop-update`. */

import type { DesktopUpdateStatus } from '../types.ts'

/** Route prefix on the shared `/api` channel. */
const PREFIX = '/api/desktop-update'

/**
 * Decode one updater JSON response.
 * @param response - Fetch response.
 * @returns a status snapshot.
 */
export async function parseUpdateResponse(response: Response): Promise<DesktopUpdateStatus> {
  if (!response.ok) {
    throw new Error(`desktop-update HTTP ${String(response.status)}`)
  }
  const body: unknown = await response.json()
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('desktop-update response is not an object')
  }
  const row = body as Record<string, unknown>
  if (typeof row.mode !== 'string') throw new Error('desktop-update response is missing mode')
  const status: {
    mode: DesktopUpdateStatus['mode']
    outdated: boolean
    current?: string
    latest?: string
    notes?: string
    error?: string
    assetName?: string
    progress?: DesktopUpdateStatus['progress']
  } = {
    mode: row.mode as DesktopUpdateStatus['mode'],
    outdated: row.outdated === true,
  }
  if (typeof row.current === 'string') status.current = row.current
  if (typeof row.latest === 'string') status.latest = row.latest
  if (typeof row.notes === 'string') status.notes = row.notes
  if (typeof row.error === 'string') status.error = row.error
  if (typeof row.assetName === 'string') status.assetName = row.assetName
  if (isProgress(row.progress)) status.progress = row.progress
  return status as DesktopUpdateStatus
}

function isProgress(value: unknown): value is DesktopUpdateStatus['progress'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.received === 'number' && typeof row.total === 'number'
}

/**
 * GET or POST an updater route.
 * @param path - path after `/api/desktop-update`.
 * @param method - HTTP method.
 * @param request - replaceable Fetch (tests).
 * @returns the decoded snapshot.
 */
export async function callUpdate(
  path: '/status' | '/check' | '/download' | '/progress' | '/apply',
  method: 'GET' | 'POST',
  request: typeof fetch = fetch,
): Promise<DesktopUpdateStatus> {
  const response = await request(`${PREFIX}${path}`, { method, credentials: 'same-origin' })
  return parseUpdateResponse(response)
}
