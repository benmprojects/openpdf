import { PDFDocument, degrees } from 'pdf-lib'

/** Structural page edits. Each takes PDF bytes and returns new bytes; none touch annotations. */

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false })
const sorted = (pages: number[]) => [...new Set(pages)].sort((a, b) => a - b)

export async function rotatePages(bytes: Uint8Array, pages: number[], delta: 90 | -90 | 180): Promise<Uint8Array> {
  const doc = await load(bytes)
  for (const i of pages) {
    const p = doc.getPage(i)
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360))
  }
  return doc.save()
}

export async function deletePages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  const del = sorted(pages)
  if (del.length >= doc.getPageCount()) throw new Error('A document must keep at least one page.')
  for (const i of del.reverse()) doc.removePage(i)
  return doc.save()
}

/**
 * Moves `pages` so they sit together before the page that was at `before` (a page index in the original order;
 * `pageCount` means the end).
 */
export async function movePages(bytes: Uint8Array, pages: number[], before: number): Promise<Uint8Array> {
  const doc = await load(bytes)
  const n = doc.getPageCount()
  const moving = sorted(pages)
  const movingSet = new Set(moving)
  const keep = Array.from({ length: n }, (_, i) => i).filter((i) => !movingSet.has(i))
  const at = keep.filter((i) => i < before).length
  const order = [...keep.slice(0, at), ...moving, ...keep.slice(at)]
  // Re-inserting the same page objects keeps links and bookmarks that point at them valid.
  const objs = order.map((i) => doc.getPage(i))
  for (let i = n - 1; i >= 0; i--) doc.removePage(i)
  objs.forEach((p) => doc.addPage(p))
  return doc.save()
}

export async function extractPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await load(bytes)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, sorted(pages))
  copied.forEach((p) => out.addPage(p))
  return out.save()
}

/** Inserts every page of `other` (or only `otherPages`) so the first lands at index `at`. */
export async function insertPagesFrom(
  bytes: Uint8Array,
  other: Uint8Array,
  at: number,
  otherPages?: number[]
): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await load(bytes)
  const src = await load(other)
  const indices = otherPages ? sorted(otherPages) : src.getPageIndices()
  const copied = await doc.copyPages(src, indices)
  copied.forEach((p, k) => doc.insertPage(at + k, p))
  return { bytes: await doc.save(), count: copied.length }
}

/** Splits into consecutive chunks of at most `size` pages. */
export async function splitEvery(bytes: Uint8Array, size: number): Promise<{ first: number; last: number; bytes: Uint8Array }[]> {
  const src = await load(bytes)
  const n = src.getPageCount()
  const parts: { first: number; last: number; bytes: Uint8Array }[] = []
  for (let start = 0; start < n; start += size) {
    const idx = Array.from({ length: Math.min(size, n - start) }, (_, k) => start + k)
    const out = await PDFDocument.create()
    ;(await out.copyPages(src, idx)).forEach((p) => out.addPage(p))
    parts.push({ first: start + 1, last: start + idx.length, bytes: await out.save() })
  }
  return parts
}

/** Parses "1-3, 5, 8-" style page lists (1-based) into sorted 0-based indices. Throws on bad input. */
export function parsePageRanges(text: string, pageCount: number): number[] {
  const out = new Set<number>()
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part)
    if (!m || (!m[1] && !m[3])) throw new Error(`Cannot read "${part}" as a page range.`)
    const a = m[1] ? parseInt(m[1], 10) : 1
    const b = m[2] ? (m[3] ? parseInt(m[3], 10) : pageCount) : a
    if (a < 1 || b > pageCount || a > b) throw new Error(`"${part}" is outside pages 1 to ${pageCount}.`)
    for (let i = a; i <= b; i++) out.add(i - 1)
  }
  if (!out.size) throw new Error('Enter at least one page.')
  return sorted([...out])
}

/**
 * Inserts copies of `pages`. `where`: 'block' puts the copies straight after the last of the pages, 'each' puts them after
 * every page, 'end' at the end of the document. `copies` is how many of each page.
 */
export async function duplicatePages(bytes: Uint8Array, pages: number[], copies = 1, where: 'block' | 'each' | 'end' = 'block'): Promise<Uint8Array> {
  const doc = await load(bytes)
  const idx = sorted(pages)
  if (where === 'each') {
    // From the last page backwards so earlier indices stay valid.
    for (const i of [...idx].reverse()) {
      for (let c = 0; c < copies; c++) doc.insertPage(i + 1, (await doc.copyPages(doc, [i]))[0])
    }
    return doc.save()
  }
  let at = where === 'end' ? doc.getPageCount() : idx[idx.length - 1] + 1
  for (let c = 0; c < copies; c++) {
    const made = await doc.copyPages(doc, idx)
    made.forEach((p, k) => doc.insertPage(at + k, p))
    at += made.length
  }
  return doc.save()
}

/** A new document made of several documents (each all of its pages, or `pages`), in order. */
export async function mergeDocuments(items: { data: Uint8Array; pages?: number[] | null }[]): Promise<{ bytes: Uint8Array; count: number }> {
  const out = await PDFDocument.create()
  let total = 0
  for (const it of items) {
    const src = await load(it.data)
    const copied = await out.copyPages(src, it.pages ? sorted(it.pages) : src.getPageIndices())
    copied.forEach((p) => out.addPage(p))
    total += copied.length
  }
  return { bytes: await out.save(), count: total }
}

/** Inserts blank pages of the given size (points) so the first lands at index `at`. */
export async function insertBlankPages(bytes: Uint8Array, at: number, count: number, size: { width: number; height: number }): Promise<Uint8Array> {
  const doc = await load(bytes)
  for (let k = 0; k < count; k++) doc.insertPage(at + k, [size.width, size.height])
  return doc.save()
}

/** Inserts several documents (each all of its pages, or `pages`) in order, the first landing at index `at`. */
export async function insertMany(
  bytes: Uint8Array,
  at: number,
  items: { data: Uint8Array; pages?: number[] | null }[]
): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await load(bytes)
  let total = 0
  for (const it of items) {
    const src = await load(it.data)
    const copied = await doc.copyPages(src, it.pages ? sorted(it.pages) : src.getPageIndices())
    copied.forEach((p, k) => doc.insertPage(at + total + k, p))
    total += copied.length
  }
  return { bytes: await doc.save(), count: total }
}

/** Replaces `pages` with pages of `other` (all of them, or `otherPages`), placed where the first replaced page was. */
export async function replacePages(bytes: Uint8Array, pages: number[], other: Uint8Array, otherPages?: number[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  const src = await load(other)
  const gone = sorted(pages)
  const copied = await doc.copyPages(src, otherPages ? sorted(otherPages) : src.getPageIndices())
  if (!copied.length) throw new Error('There are no pages to put in.')
  for (const i of [...gone].reverse()) doc.removePage(i)
  copied.forEach((p, k) => doc.insertPage(gone[0] + k, p))
  return doc.save()
}

export interface Part {
  first: number
  last: number
  title?: string
  bytes: Uint8Array
}

/** One file per range (1-based, inclusive). */
export async function splitByRanges(bytes: Uint8Array, ranges: { first: number; last: number; title?: string }[]): Promise<Part[]> {
  const src = await load(bytes)
  const parts: Part[] = []
  for (const r of ranges) {
    const out = await PDFDocument.create()
    ;(await out.copyPages(src, Array.from({ length: r.last - r.first + 1 }, (_, k) => r.first - 1 + k))).forEach((p) => out.addPage(p))
    parts.push({ ...r, bytes: await out.save() })
  }
  return parts
}

/**
 * Page ranges from the top-level bookmarks: each runs from its bookmark's page to the page before the next.
 * Pages before the first bookmark form their own range.
 */
export function bookmarkRanges(top: { title: string; page: number }[], pageCount: number): { first: number; last: number; title?: string }[] {
  const marks = top
    .filter((b) => b.page >= 0 && b.page < pageCount)
    .sort((a, b) => a.page - b.page)
    .filter((b, i, all) => i === 0 || b.page !== all[i - 1].page)
  if (!marks.length) return [{ first: 1, last: pageCount }]
  const out: { first: number; last: number; title?: string }[] = []
  if (marks[0].page > 0) out.push({ first: 1, last: marks[0].page })
  marks.forEach((b, i) => out.push({ first: b.page + 1, last: i + 1 < marks.length ? marks[i + 1].page : pageCount, title: b.title }))
  return out
}

/** Consecutive files each at most about `maxBytes` (a single page bigger than that gets a file of its own). */
export async function splitBySize(bytes: Uint8Array, maxBytes: number): Promise<Part[]> {
  const src = await load(bytes)
  const n = src.getPageCount()
  const build = async (first: number, last: number) => {
    const out = await PDFDocument.create()
    ;(await out.copyPages(src, Array.from({ length: last - first + 1 }, (_, k) => first + k))).forEach((p) => out.addPage(p))
    return out.save()
  }
  const parts: Part[] = []
  let start = 0
  while (start < n) {
    let end = start
    let best = await build(start, start)
    // Grow the part a page at a time while it still fits.
    while (end + 1 < n) {
      const next = await build(start, end + 1)
      if (next.length > maxBytes) break
      end++
      best = next
    }
    parts.push({ first: start + 1, last: end + 1, bytes: best })
    start = end + 1
  }
  return parts
}
