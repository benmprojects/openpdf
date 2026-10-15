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
