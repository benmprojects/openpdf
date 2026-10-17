import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { checkPdfUrl, fileNameFor, looksLikePdf, MAX_URL_BYTES, sizeLimitMessage, statusMessage } from '../shared/openUrl'

export type UrlResult = { ok: true; name: string; data: Uint8Array } | { ok: false; error: string }

export interface DownloadOptions {
  maxBytes?: number
  timeoutMs?: number
  /** A folder to make the temporary download folder in. */
  tmpRoot: string
}

/**
 * Downloads a PDF from an https address into a temporary file (so a failure leaves nothing behind and the whole
 * download is never held twice), checks it, and returns its bytes. The temporary folder is always removed.
 * Every failure comes back as a message for the person, never as a thrown error.
 */
export async function downloadPdf(address: string, fetchFn: typeof fetch, o: DownloadOptions): Promise<UrlResult> {
  const checked = checkPdfUrl(address)
  if (!checked.ok) return checked
  const max = o.maxBytes ?? MAX_URL_BYTES
  const dir = await mkdtemp(join(o.tmpRoot, 'openpdf-url-'))
  try {
    let res: Response
    try {
      res = await fetchFn(checked.url.href, { redirect: 'follow', signal: AbortSignal.timeout(o.timeoutMs ?? 60_000), headers: { Accept: 'application/pdf,*/*;q=0.5' } })
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      return { ok: false, error: timeout ? 'The server took too long to answer.' : `Could not reach ${checked.url.hostname}. Check the address and your connection.` }
    }
    // A redirect from https to plain http would defeat the point of refusing http.
    if (res.url && !/^https:/i.test(res.url)) return { ok: false, error: 'The address redirected to a page that is not https, so it was not opened.' }
    if (!res.ok) return { ok: false, error: statusMessage(res.status, res.statusText) }
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > max) return { ok: false, error: sizeLimitMessage(max) }
    if (!res.body) return { ok: false, error: 'The server sent nothing.' }

    const file = join(dir, 'download.pdf')
    const out = await open(file, 'w')
    let total = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > max) {
          await reader.cancel().catch(() => undefined)
          return { ok: false, error: sizeLimitMessage(max) }
        }
        await out.write(value)
      }
    } catch {
      return { ok: false, error: 'The download stopped before it finished.' }
    } finally {
      await out.close()
    }
    const data = new Uint8Array(await readFile(file))
    if (!looksLikePdf(data)) return { ok: false, error: 'That address did not return a PDF document.' }
    return { ok: true, name: fileNameFor(checked.url, res.headers.get('content-disposition')), data }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
