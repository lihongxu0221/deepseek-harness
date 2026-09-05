/** Select the newest GitHub zip asset for the packaged Windows desktop. */

import type { GitHubRelease, GitHubReleaseAsset, SelectedRelease } from './types.ts'
import { compareWinexeVersion, parseWinexeVersion } from './version.ts'

/**
 * Parse a GitHub Releases API JSON array. Malformed payloads fail loud.
 * @param value - decoded JSON.
 * @returns typed release rows.
 * @throws when the payload is not an array of release objects.
 */
export function parseGitHubReleases(value: unknown): GitHubRelease[] {
  if (!Array.isArray(value)) throw new Error('GitHub releases response is not an array')
  return value.map((row, index) => parseGitHubRelease(row, index))
}

function parseGitHubRelease(value: unknown, index: number): GitHubRelease {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`GitHub release ${String(index)} is not an object`)
  }
  const row = value as Record<string, unknown>
  if (typeof row.tag_name !== 'string' || row.tag_name === '') {
    throw new Error(`GitHub release ${String(index)} is missing tag_name`)
  }
  if (!Array.isArray(row.assets)) {
    throw new Error(`GitHub release ${String(index)} is missing assets`)
  }
  return {
    tag_name: row.tag_name,
    prerelease: row.prerelease === true,
    draft: row.draft === true,
    body: typeof row.body === 'string' ? row.body : null,
    assets: row.assets.map((asset, assetIndex) => parseGitHubAsset(asset, index, assetIndex)),
  }
}

function parseGitHubAsset(value: unknown, releaseIndex: number, assetIndex: number): GitHubReleaseAsset {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`GitHub release ${String(releaseIndex)} asset ${String(assetIndex)} is not an object`)
  }
  const row = value as Record<string, unknown>
  if (typeof row.name !== 'string' || row.name === '') {
    throw new Error(`GitHub release ${String(releaseIndex)} asset ${String(assetIndex)} is missing name`)
  }
  if (typeof row.browser_download_url !== 'string' || row.browser_download_url === '') {
    throw new Error(`GitHub release ${String(releaseIndex)} asset ${String(assetIndex)} is missing browser_download_url`)
  }
  const size = typeof row.size === 'number' && Number.isFinite(row.size) && row.size >= 0 ? row.size : 0
  return {
    name: row.name,
    browser_download_url: row.browser_download_url,
    size,
    ...(typeof row.digest === 'string' ? { digest: row.digest } : {}),
  }
}

/**
 * Read the product stamp from a zip asset filename.
 * @param name - GitHub asset filename.
 * @param prefix - required filename prefix, such as `dsh-web-win-x64-`.
 * @returns the stamp between the prefix and `.zip`, or `undefined`.
 */
export function versionFromAssetName(name: string, prefix: string): string | undefined {
  if (prefix === '' || !name.startsWith(prefix) || !name.endsWith('.zip')) return undefined
  const stamp = name.slice(prefix.length, -'.zip'.length)
  return parseWinexeVersion(stamp) === undefined ? undefined : stamp
}

/**
 * Pick the highest-version zip among non-draft releases. Source zipballs are
 * ignored because they are not a packaged desktop.
 * @param releases - GitHub Releases API rows.
 * @param assetPrefix - required asset filename prefix.
 * @returns the newest matching zip, or `undefined` when none match.
 */
export function pickNewestZip(
  releases: readonly GitHubRelease[],
  assetPrefix: string,
): SelectedRelease | undefined {
  let best: SelectedRelease | undefined
  for (const release of releases) {
    if (release.draft) continue
    const asset = release.assets.find(candidate => versionFromAssetName(candidate.name, assetPrefix) !== undefined)
    if (asset === undefined) continue
    const version = versionFromAssetName(asset.name, assetPrefix)
    /* v8 ignore next -- find() already proved the filename parses */
    if (version === undefined) continue
    const candidate: SelectedRelease = {
      version,
      tag: release.tag_name,
      assetName: asset.name,
      downloadUrl: asset.browser_download_url,
      size: asset.size,
      ...(asset.digest === undefined ? {} : { digest: asset.digest }),
      ...(release.body === undefined || release.body === null || release.body === ''
        ? {}
        : { notes: release.body }),
    }
    if (best === undefined || compareWinexeVersion(candidate.version, best.version) > 0) {
      best = candidate
    }
  }
  return best
}

/**
 * Whether `latest` is a packaged stamp strictly newer than `current`.
 * @param current - installed VERSION stamp.
 * @param latest - candidate stamp.
 * @returns true when an update is available.
 */
export function isOutdated(current: string, latest: string): boolean {
  return compareWinexeVersion(latest, current) > 0
}
