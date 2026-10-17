/**
 * Which web addresses OpenPDF will fetch on a certificate's say-so. The addresses for revocation checks come from inside
 * the certificate of whoever signed a document, so they are not trusted: only plain http and https addresses to public
 * internet hosts are used, never this computer or the local network. Pure.
 */

const PRIVATE_V4: [number, number][] = [
  [0x00000000, 8], // this network
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 shared address space
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link local, including cloud metadata addresses
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xe0000000, 4], // multicast
  [0xf0000000, 4] // reserved
]

function v4(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((p) => p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

const inRange = (ip: number, [base, bits]: [number, number]) => (bits === 0 ? true : ip >>> (32 - bits) === base >>> (32 - bits))

/** Whether a host name or address is on this computer or a private network (or not a plain public name). */
export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!host) return true
  const ip4 = v4(host)
  if (ip4 !== null) return PRIVATE_V4.some((r) => inRange(ip4, r))
  if (host.includes(':')) {
    // IPv6: only global unicast (2000::/3) is public; an IPv4-mapped address is judged by its IPv4 part.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)
    if (mapped) return isPrivateHost(mapped[1])
    return !/^[23][0-9a-f]{3}:/.test(host)
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home') || host.endsWith('.corp')) return true
  // A single-label name resolves on the local network.
  if (!host.includes('.')) return true
  // Numbers in other notations (0x7f.1, 2130706433) are read as addresses by the system.
  if (/^[0-9x.]+$/i.test(host)) return true
  return false
}

/** The address when it may be fetched for a revocation check, or null. */
export function publicHttpUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (isPrivateHost(u.hostname)) return null
  return u
}
