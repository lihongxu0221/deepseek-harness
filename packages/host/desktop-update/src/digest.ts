/** SHA-256 digest helpers for GitHub release assets. */

const SHA256 = /^sha256:([0-9a-f]{64})$/iu

/**
 * Read the hex SHA-256 from a GitHub asset `digest` field.
 * @param digest - GitHub digest, or `undefined` when the API omitted it.
 * @returns lowercase hex, or `undefined` when missing or malformed.
 */
export function parseSha256Digest(digest: string | undefined): string | undefined {
  if (digest === undefined) return undefined
  const match = SHA256.exec(digest.trim())
  const hex = match?.[1]
  return hex === undefined ? undefined : hex.toLowerCase()
}

/**
 * Compare a computed file hash with the GitHub digest. A missing or malformed
 * digest is a failure: the updater never installs a zip it cannot authenticate.
 * @param actualHex - lowercase hex SHA-256 of the downloaded file.
 * @param digest - GitHub asset digest.
 * @returns an error message when the digest does not match, otherwise `undefined`.
 */
export function digestMismatch(actualHex: string, digest: string | undefined): string | undefined {
  const expected = parseSha256Digest(digest)
  if (expected === undefined) {
    return 'GitHub asset digest is missing or not sha256'
  }
  if (actualHex.toLowerCase() !== expected) {
    return `zip sha256 ${actualHex} does not match GitHub digest ${expected}`
  }
  return undefined
}
