import { PdfClient } from './pdfClient'
import { findInPage } from './textLogic'

export interface SearchSource {
  name: string
  path?: string
  /** Bytes when already in memory (open documents); otherwise read from `path`. */
  data?: Uint8Array
}

export interface FileHit {
  page: number
  from: number
  to: number
  /** The text around the match, with the match at [before.length, before.length + match.length). */
  before: string
  match: string
  after: string
}

export interface FileResult {
  source: SearchSource
  hits: FileHit[]
  /** Set when the file could not be searched (password, damaged). */
  error?: string
  /** Stopped at the per-file limit. */
  truncated?: boolean
}

const PER_FILE = 200
const CONTEXT = 40

/**
 * Searches each file in turn with one PDFium worker, reporting each file's result as soon as it is done.
 * Only one document is loaded at a time.
 */
export async function searchFiles(
  sources: SearchSource[],
  query: string,
  opts: { matchCase: boolean; wholeWord: boolean },
  onFile: (r: FileResult, done: number) => void,
  signal: AbortSignal
): Promise<void> {
  if (!query) return
  for (let i = 0; i < sources.length; i++) {
    if (signal.aborted) return
    const source = sources[i]
    // A fresh worker per file keeps memory bounded and isolates a file that crashes PDFium.
    const client = new PdfClient()
    try {
      const data = source.data ?? (source.path ? (await window.openpdf.readFile(source.path)).data : null)
      if (!data) throw new Error('No data')
      const pages = await client.load(data)
      const hits: FileHit[] = []
      let truncated = false
      for (let p = 0; p < pages.length && !truncated; p++) {
        if (signal.aborted) return
        const pt = await client.pageText(p)
        for (const m of findInPage(pt, p, query, opts.matchCase, opts.wholeWord)) {
          // Matches are in character indices; the text is in UTF-16 units. Map back to slice the context.
          const text = pt.text
          const a = Math.max(0, pt.charOf.indexOf(m.from))
          const b = Math.max(a, pt.charOf.lastIndexOf(m.to) + 1)
          hits.push({
            page: p,
            from: m.from,
            to: m.to,
            before: oneLine(text.slice(Math.max(0, a - CONTEXT), a)),
            match: oneLine(text.slice(a, b)),
            after: oneLine(text.slice(b, b + CONTEXT))
          })
          if (hits.length >= PER_FILE) {
            truncated = true
            break
          }
        }
      }
      onFile({ source, hits, truncated }, i + 1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      onFile({ source, hits: [], error: /password/i.test(msg) ? 'Password protected: not searched' : `Could not be searched: ${msg}` }, i + 1)
    } finally {
      client.dispose()
    }
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ')
