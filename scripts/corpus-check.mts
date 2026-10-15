/**
 * Corpus check: every PDF in a folder goes through what opening, viewing and saving does — PDFium load, page
 * sizes, rendering, text, annotations, links, bookmarks, page labels and attachments; pdf-lib annotation extras;
 * and a save that re-authors every annotation, re-opened in PDFium. Encrypted files are decrypted with qpdf
 * first, as the app does before editing. Nothing may crash or hang.
 * Usage: npx tsx scripts/corpus-check.mts <folder> [--pages N] [--strict]
 * The folder is searched recursively. Statuses: ok; refused (PDFium would not open it, so the app shows an
 * error); warn (it opens, but pdf-lib cannot save it or the save lost annotations); FAIL (crash, hang, or our
 * code threw on a file PDFium opened). With --strict (the generated corpus from make-corpus.py) a refusal is
 * only allowed for files damaged on purpose (names starting "bad-", "truncated" or "no-") and a warn is a FAIL.
 * Files named "...pw-<password>..." are opened with that password.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { PDFDocument } from 'pdf-lib'
import { decryptPdf } from '../src/main/qpdf'
import { annotDicts } from '../src/renderer/src/annotExtras'
import { writeAnnotations } from '../src/renderer/src/annotWrite'
import { annotsFromImported } from '../src/renderer/src/importMap'
import { readLabelRanges } from '../src/renderer/src/outlineEdit'
import { readAttachments, readOutline, readPageAnnots, readPageLabels, readPageLinks, readPageText } from '../src/renderer/src/pdfiumRaw'
import type { Annot } from '../src/renderer/src/annotations'

const args = process.argv.slice(2)
const dir = args[0]
const maxPages = (args.includes('--pages') && Number(args[args.indexOf('--pages') + 1])) || 20
const strict = args.includes('--strict')
if (!dir) {
  console.error('Usage: npx tsx scripts/corpus-check.mts <folder> [--pages N] [--strict]')
  process.exit(2)
}

const lib = await PDFiumLibrary.init()
type Row = { file: string; status: 'ok' | 'refused' | 'warn' | 'FAIL'; pages: number; annots: number; ms: number; note: string }
const rows: Row[] = []

/** Opens a document, reads everything we read when viewing, and returns the imported annotations. */
/** PDFium would not open the file. */
class Refused extends Error {}

async function view(bytes: Uint8Array, password: string | undefined) {
  const doc = await lib.loadDocument(bytes.slice(), password).catch((e: unknown) => {
    throw e instanceof Error && !(e instanceof WebAssembly.RuntimeError) ? new Refused(e.message) : e
  })
  try {
    const dicts = password ? null : await annotDicts(bytes)
    const annots: Annot[] = []
    let id = 1
    const n = doc.getPageCount()
    for (let i = 0; i < n; i++) {
      const page = doc.getPage(i)
      try {
        const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
        if (!(w > 0 && h > 0)) throw new Error(`page ${i + 1} has size ${w} x ${h}`)
        if (i < maxPages) {
          // Small enough to be quick, large enough to draw something; huge pages are capped to ~2 Mpx.
          const scale = Math.min(0.5, Math.sqrt(2e6 / (w * h)))
          const r = await page.render({ scale, render: 'bitmap' })
          if (!r.data.length) throw new Error(`page ${i + 1} rendered nothing`)
          readPageText(lib, page)
          readPageLinks(lib, doc, page)
        }
        const { annots: list, replies } = readPageAnnots(lib, page, dicts?.[i])
        annots.push(...annotsFromImported(i, list, replies, () => id++))
      } finally {
        page.close()
      }
    }
    readOutline(lib, doc)
    readPageLabels(lib, doc)
    readAttachments(lib, doc)
    return { pages: n, annots }
  } finally {
    doc.destroy()
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))])

const files = (readdirSync(dir, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
  .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.pdf'))
  .map((d) => `${d.parentPath}/${d.name}`)
  .sort()
for (const full of files) {
  const file = relative(dir, full).replace(/\\/g, '/')
  const bytes = new Uint8Array(readFileSync(full))
  const password = /pw-([^.\-_]+)/.exec(file)?.[1]
  const damaged = /(^|\/)(bad-|truncated|no-)[^/]*$/.test(file)
  const t = performance.now()
  const row: Row = { file, status: 'ok', pages: 0, annots: 0, ms: 0, note: '' }
  try {
    const first = await withTimeout(view(bytes, password), 60_000)
    row.pages = first.pages
    row.annots = first.annots.length
    let encrypted = false
    let plain = bytes
    try {
      encrypted = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).isEncrypted
      if (encrypted) plain = await decryptPdf(bytes, password ?? '')
    } catch (e) {
      if (!(e instanceof Error)) throw e
      row.status = 'warn'
      row.note = `opens, but cannot be saved: ${e.message.slice(0, 90)}`
    }
    if (row.status === 'ok') {
      const open = Math.round(performance.now() - t)
      if (open > 1000) row.note = `open ${open} ms; `
      await readLabelRanges(plain)
      // Re-author every annotation, then check the saved file opens with the same pages and annotation count.
      const annots = encrypted ? (await view(plain, undefined)).annots : first.annots
      const saved = await withTimeout(writeAnnotations(plain, annots, [], new Set(annots.map((a) => a.id))), 60_000).catch((e: unknown) => {
        if (e instanceof Error && !/timed out/.test(e.message)) return e
        throw e
      })
      if (saved instanceof Error) throw Object.assign(new Error(`save failed: ${saved.message}`), { warn: true })
      const again = await withTimeout(view(saved, undefined), 60_000)
      if (again.pages !== first.pages) throw new Error(`saved copy has ${again.pages} pages, not ${first.pages}`)
      if (again.annots.length !== annots.length) {
        row.status = 'warn'
        row.note += `annotations after save: ${again.annots.length} of ${annots.length}; `
      }
      if (encrypted) row.note += 'decrypted with qpdf'
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    row.status = e instanceof Refused ? (strict && !damaged ? 'FAIL' : 'refused') : (e as { warn?: boolean })?.warn ? 'warn' : 'FAIL'
    row.note = msg.slice(0, 120)
  }
  if (strict && row.status === 'warn') row.status = 'FAIL'
  row.ms = Math.round(performance.now() - t)
  rows.push(row)
}

const pad = (s: string | number, n: number) => String(s).padEnd(n)
const width = Math.max(34, ...rows.map((r) => r.file.length + 2))
console.log(`${pad('file', width)}${pad('status', 9)}${pad('pages', 7)}${pad('annots', 8)}${pad('ms', 8)}note`)
for (const r of rows) console.log(`${pad(r.file, width)}${pad(r.status, 9)}${pad(r.pages, 7)}${pad(r.annots, 8)}${pad(r.ms, 8)}${r.note}`)
const failed = rows.filter((r) => r.status === 'FAIL')
const count = (s: Row['status']) => rows.filter((r) => r.status === s).length
console.log(`\n${rows.length} files: ${count('ok')} ok, ${count('refused')} refused by PDFium, ${count('warn')} warnings, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
