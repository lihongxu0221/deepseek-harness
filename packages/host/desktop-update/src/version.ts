/**
 * Parse and compare packaged-desktop `{semver}.winexe.{n}` stamps.
 * GitHub tags may prefix the stamp with `winexe-`.
 */

import type { WinexeVersion } from './types.ts'

/** Stamp with an explicit winexe iteration. */
const WINEXE_SUFFIX = /^(.+)\.winexe\.(\d+)$/u

/** Semver core plus optional prerelease; build metadata is ignored. */
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u

/** Parsed semver identifiers used only for precedence. */
interface SemverParts {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

/**
 * Parse a semantic version string (leading `v` tolerated, build metadata ignored).
 * @param value - version string such as `0.1.2-rc.1`.
 * @returns the parsed parts, or `undefined` when unparseable.
 */
export function parseSemver(value: string): SemverParts | undefined {
  const match = SEMVER.exec(value.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Compare two semantic versions. An unparseable value sorts below every
 * parseable one; two unparseable values compare equal.
 * @param a - first version.
 * @param b - second version.
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa === undefined && pb === undefined) return 0
  if (pa === undefined) return -1
  if (pb === undefined) return 1
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0
  if (pa.prerelease.length === 0) return 1
  if (pb.prerelease.length === 0) return -1
  const length = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let index = 0; index < length; index++) {
    const ra = pa.prerelease[index]
    const rb = pb.prerelease[index]
    if (ra === undefined) return -1
    if (rb === undefined) return 1
    if (ra === rb) continue
    const numericA = /^\d+$/u.test(ra)
    const numericB = /^\d+$/u.test(rb)
    if (numericA && numericB) return Number(ra) < Number(rb) ? -1 : 1
    if (numericA) return -1
    if (numericB) return 1
    return ra < rb ? -1 : 1
  }
  return 0
}

/**
 * Strip an optional `winexe-` tag prefix and parse `{semver}` or `{semver}.winexe.{n}`.
 * @param value - VERSION file contents or a GitHub tag / asset stamp.
 * @returns the parsed stamp, or `undefined` when unparseable.
 */
export function parseWinexeVersion(value: string): WinexeVersion | undefined {
  const trimmed = value.trim().replace(/^winexe-/u, '')
  if (trimmed === '') return undefined
  const match = WINEXE_SUFFIX.exec(trimmed)
  if (match !== null) {
    const base = match[1]
    /* v8 ignore next -- the capture is required by the winexe suffix pattern */
    if (base === undefined || parseSemver(base) === undefined) return undefined
    return { raw: trimmed, base, iter: Number(match[2]) }
  }
  if (parseSemver(trimmed) === undefined) return undefined
  return { raw: trimmed, base: trimmed, iter: 0 }
}

/**
 * Compare two packaged-desktop stamps. Base semver wins; the winexe iteration
 * is a tiebreaker only when the bases are equal. Unparseable values sort below
 * parseable ones.
 * @param a - first stamp.
 * @param b - second stamp.
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareWinexeVersion(a: string, b: string): number {
  const pa = parseWinexeVersion(a)
  const pb = parseWinexeVersion(b)
  if (pa === undefined && pb === undefined) return 0
  if (pa === undefined) return -1
  if (pb === undefined) return 1
  const base = compareSemver(pa.base, pb.base)
  if (base !== 0) return base
  return pa.iter - pb.iter
}
