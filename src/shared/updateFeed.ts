/** An https address, or an http one on this computer (for testing a feed). No user name or password in it. */
export function feedAllowed(u: string): boolean {
  try {
    const url = new URL(u)
    if (url.username || url.password) return false
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch {
    return false
  }
}

/** Whether version `a` (for example "0.1.1" or "v0.2.0") is newer than `b`. Pre-release suffixes are ignored. */
export function isNewerVersion(a: string, b: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d > 0
  }
  return false
}
