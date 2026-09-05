/**
 * Loopback classification for updater control routes. LAN and phone origins
 * must not start a zip download or replace the product folder.
 */

/**
 * Whether a WHATWG URL hostname names the local loopback authority.
 * @param hostname - URL hostname (IPv6 literals retain brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

/**
 * Whether a Fetch request targeted a loopback URL.
 * @param request - incoming Fetch request.
 * @returns true when the request URL hostname is loopback.
 */
export function isLoopbackRequest(request: Request): boolean {
  try {
    return isLoopbackHostname(new URL(request.url).hostname)
  } catch {
    return false
  }
}
