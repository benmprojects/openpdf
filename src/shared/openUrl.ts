/** Rules for opening a PDF from a web address: what is accepted, what the file is called, and what the errors say. */

/** The largest download accepted. */
export const MAX_URL_BYTES = 250 * 1024 * 1024

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string }

/** Only https addresses with a host and no embedded user name or password. */
export function checkPdfUrl(text: string): UrlCheck {
  const raw = text.trim()
  if (!raw) return { ok: false, error: 'Type or paste the address of a PDF.' }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { ok: false, error: 'Only https:// addresses can be opened.' }
  }
  if (/^http:\/\//i.test(raw)) return { ok: false, error: 'Only https:// addresses can be opened, because http:// is not private. Try the same address with https://.' }
  let url: URL
  try {
    url = new URL(/^https:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return { ok: false, error: `"${raw.slice(0, 80)}" is not a web address.` }
  }
  if (url.protocol !== 'https:' || !url.hostname) return { ok: false, error: 'Only https:// addresses can be opened.' }
  if (url.username || url.password) return { ok: false, error: 'Addresses with a user name or password in them cannot be opened.' }
  return { ok: true, url }
}

/** A safe file name ending in .pdf: from the server's Content-Disposition, else the last part of the path, else "download". */
export function fileNameFor(url: URL, disposition?: string | null): string {
  let name = ''
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition ?? '')
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition ?? '')
  try {
    if (star) name = decodeURIComponent(star[1].trim())
  } catch {
    name = ''
  }
  if (!name && plain) name = plain[1].trim()
  if (!name) {
    try {
      name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
    } catch {
      name = url.pathname.split('/').filter(Boolean).pop() ?? ''
    }
  }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120)
  if (!name) name = 'download'
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`
}

/** A PDF has "%PDF-" within its first kilobyte. */
export function looksLikePdf(head: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(head.subarray(0, 1024))
  return text.includes('%PDF-')
}

export function statusMessage(status: number, statusText: string): string {
  const why = statusText ? ` (${statusText})` : ''
  if (status === 401 || status === 403) return `The server would not let OpenPDF download that file${why}. It may need you to sign in; download it in your browser and open it from your computer.`
  if (status === 404 || status === 410) return `There is no file at that address${why}.`
  if (status >= 500) return `The server had a problem and answered ${status}${why}. Try again later.`
  return `The server answered ${status}${why}.`
}

export const sizeLimitMessage = (maxBytes: number): string =>
  `That file is larger than ${maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / (1024 * 1024))} MB` : `${Math.max(1, Math.round(maxBytes / 1024))} KB`}, so it was not downloaded.`
