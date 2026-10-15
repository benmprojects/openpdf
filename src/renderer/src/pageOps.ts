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
