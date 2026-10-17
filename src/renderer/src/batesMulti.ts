/**
 * Bates and page numbering that runs on across several files: the number carries from one file to the next, the
 * first and last number of each file are previewed up front, and a log (CSV) records them.
 */
import { PDFDocument } from 'pdf-lib'
import { addHeaderFooter, batesNumber, type HeaderFooterSpec } from './pageMarks'

export interface BatesFormat {
  prefix: string
  suffix: string
  start: number
  digits: number
}

export interface NumberedFile {
  name: string
  pages: number
  /** The Bates number on the first and last page ('' when the file has no pages). */
  first: string
  last: string
  /** The running page number (for page numbering mode) on the first and last page. */
  firstPage: number
  lastPage: number
}

/** First and last number of each file when the numbering carries on from one to the next, in the order given. */
export function planNumbering(files: { name: string; pages: number }[], format: BatesFormat, pageStart = 1): NumberedFile[] {
  let offset = 0
  return files.map((f) => {
    const out: NumberedFile = {
      name: f.name,
      pages: f.pages,
      first: f.pages > 0 ? batesNumber(format, offset) : '',
      last: f.pages > 0 ? batesNumber(format, offset + f.pages - 1) : '',
      firstPage: pageStart + offset,
      lastPage: pageStart + offset + f.pages - 1
    }
    offset += f.pages
    return out
  })
}

/** Total pages over the files. */
export const totalPages = (files: { pages: number }[]): number => files.reduce((n, f) => n + f.pages, 0)

/** Whether the highest number fits in the digits chosen (a number wider than the digits still prints, but is not padded). */
export function digitsNeeded(format: BatesFormat, total: number): number {
  return String(format.start + Math.max(0, total - 1)).length
}

const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface LogRow {
  source: string
  output: string
  pages: number
  first: string
  last: string
  error?: string
}

/** The log of a run as CSV (comma separated, header row, Windows line ends). */
export function batesLogCsv(rows: LogRow[]): string {
  const head = ['File', 'Output', 'Pages', 'First number', 'Last number', 'Result']
  const lines = [head, ...rows.map((r) => [r.source, r.output, r.pages, r.first, r.last, r.error ? `Failed: ${r.error}` : 'Done'])]
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Page count of PDF bytes. */
export async function countPages(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
}

/**
 * Numbers one file as part of a run: `offset` pages have been numbered before it. The template spec gives the
 * position, font and text; every page of the file is marked.
 */
export async function numberFile(
  bytes: Uint8Array,
  fileName: string,
  template: Omit<HeaderFooterSpec, 'pages' | 'startNumber' | 'bates' | 'totalPages'>,
  format: BatesFormat,
  offset: number,
  pageStart: number,
  grandTotal: number
): Promise<{ bytes: Uint8Array; pages: number }> {
  const pages = await countPages(bytes)
  const out = await addHeaderFooter(
    bytes,
    {
      ...template,
      pages: Array.from({ length: pages }, (_, i) => i),
      startNumber: pageStart + offset,
      totalPages: pageStart + grandTotal - 1,
      bates: { ...format, start: format.start + offset }
    },
    { fileName, labels: null }
  )
  return { bytes: out, pages }
}
