/**
 * Host classification for updater control routes. A Host that is neither
 * loopback nor a current IPv4 address of this machine must not start a zip
 * download or replace the product folder.
 */

import { networkInterfaces } from 'node:os'

/** One `os.networkInterfaces()` row used to collect this machine's LAN IPv4s. */
interface LanAddressCarrier {
  /** Node reports `IPv4` / `IPv6`. */
  readonly family: string
  /** True for loopback interfaces. */
  readonly internal: boolean
  /** Interface address without brackets. */
  readonly address: string
}

/**
 * Non-internal IPv4 addresses currently assigned to this machine.
 * A host may have several (Wi-Fi, Ethernet, VPN); none is canonical.
 * @param ifaces - `os.networkInterfaces()` snapshot (tests inject a fixture).
 * @returns IPv4 literals in enumeration order, possibly empty.
 */
export function localLanIpv4Addresses(
  ifaces: NodeJS.Dict<LanAddressCarrier[] | undefined> = networkInterfaces(),
): string[] {
  return Object.values(ifaces).flat()
    .filter((iface): iface is LanAddressCarrier =>
      iface !== undefined && iface.family === 'IPv4' && !iface.internal)
    .map(iface => iface.address)
}

/**
 * Whether a normalized URL hostname names the local loopback authority.
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
 * Whether updater control may run for this request.
 * Prefers the Host header: Connection's `/api` HTTP bridge builds Fetch URLs
 * on `http://dsh.internal`, so the URL hostname is not the client-facing
 * authority. When Host is absent, falls back to the request URL hostname.
 * Allows loopback and every current non-internal IPv4 of this machine.
 * @param request - incoming Fetch request.
 * @param lanAddresses - this machine's LAN IPv4s; defaults to a live sample.
 * @returns true when the client-facing hostname is this machine.
 */
export function isLoopbackRequest(
  request: Request,
  lanAddresses: readonly string[] = localLanIpv4Addresses(),
): boolean {
  try {
    const host = request.headers.get('host')
    const hostname = host !== null && host !== ''
      ? new URL(`http://${host}`).hostname
      : new URL(request.url).hostname
    return isLoopbackHostname(hostname) || lanAddresses.includes(hostname)
  } catch {
    // Invalid Host or request URL cannot be classified as this machine.
    return false
  }
}
