/**
 * Submit-form buttons: what is sent to the web address, in the format the button asks for (ISO 32000 12.7.5.2).
 */
import { toFdfData, toXfdfData, type DataEntry } from './formData'

export type SubmitFormat = 'fdf' | 'xfdf' | 'html' | 'pdf'

export interface SubmitPayload {
  contentType: string
  body: Uint8Array
}

/** Only web addresses: a form is never sent to a file or another kind of link. */
export function submitUrl(url: string): URL | null {
  try {
    const u = new URL(url.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/** HTML form encoding: name=value pairs. Unticked check boxes and empty choices are left out, as a browser would. */
export function htmlFormBody(entries: DataEntry[]): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+')
  const pairs: string[] = []
  for (const e of entries) {
    const values = Array.isArray(e.value) ? e.value : [e.value]
    for (const v of values) if (v !== 'Off') pairs.push(`${enc(e.name)}=${enc(v)}`)
  }
  return pairs.join('&')
}

/** The body and content type to send. `pdf` is the whole document with its values written in. */
export function submitPayload(format: SubmitFormat, entries: DataEntry[], fileName: string, pdf?: Uint8Array): SubmitPayload {
  if (format === 'pdf') {
    if (!pdf) throw new Error('The PDF to send is missing.')
    return { contentType: 'application/pdf', body: pdf }
  }
  const enc = new TextEncoder()
  if (format === 'fdf') return { contentType: 'application/vnd.fdf', body: toFdfData(entries, fileName) }
  if (format === 'xfdf') return { contentType: 'application/vnd.adobe.xfdf', body: enc.encode(toXfdfData(entries, fileName)) }
  return { contentType: 'application/x-www-form-urlencoded; charset=UTF-8', body: enc.encode(htmlFormBody(entries)) }
}
