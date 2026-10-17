/**
 * Named destinations: names that stand for a place in the document (a page, and a position and zoom on it), kept in the
 * catalogue's /Names /Dests name tree (ISO 32000-1 12.3.2.3). Bookmarks, links and other files can point at a name.
 *
 * Reading also takes in the old (PDF 1.1) /Dests dictionary. Writing puts every destination in one flat, sorted name
 * tree and removes the old dictionary, so the result is valid whichever form the file used.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib'

const N = PDFName.of

export type DestKind = 'XYZ' | 'Fit' | 'FitH' | 'FitV' | 'FitR' | 'FitB' | 'FitBH' | 'FitBV'

export interface Destination {
  name: string
  /** Zero-based page, or -1 when the destination points at a page the file does not have. */
  page: number
  kind: DestKind | 'other'
  /** Position on the page in PDF points from the bottom left corner (null where the destination leaves it open). */
  left: number | null
  top: number | null
  /** Zoom as a ratio (1 = 100 %); null means keep the current zoom. */
  zoom: number | null
}

/** What to create: a position on a page. `top` is measured from the bottom of the page, as in the file. */
export interface NewDestination {
  name: string
  page: number
  left?: number | null
  top?: number | null
  zoom?: number | null
}

const MAX_NAME = 120

/** Why a name cannot be used, or null when it is fine. `taken` holds the names already in use (not counting the one being renamed). */
export function checkDestinationName(name: string, taken: Iterable<string>): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Type a name for the destination.'
  if (trimmed.length > MAX_NAME) return `A name can have at most ${MAX_NAME} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return 'A name cannot contain control characters.'
  for (const t of taken) if (t === trimmed) return 'A destination with that name already exists.'
  return null
}

const textOf = (o: PDFObject | undefined): string | null => (o instanceof PDFString || o instanceof PDFHexString || o instanceof PDFName ? o.decodeText() : null)
const numOf = (o: PDFObject | undefined): number | null => (o instanceof PDFNumber ? o.asNumber() : null)

/** Every (name, value) pair of the tree, in order. */
function treePairs(node: PDFDict | undefined, out: [string, PDFObject][] = [], depth = 0, seen = new Set<PDFDict>()): [string, PDFObject][] {
  if (!node || depth > 20 || seen.has(node)) return out
  seen.add(node)
  const names = node.lookupMaybe(N('Names'), PDFArray)
  for (let i = 0; names && i + 1 < names.size(); i += 2) {
    const key = textOf(names.lookup(i))
    const value = names.get(i + 1)
    if (key !== null && value !== undefined) out.push([key, value])
  }
  const kids = node.lookupMaybe(N('Kids'), PDFArray)
  for (let i = 0; kids && i < kids.size(); i++) treePairs(kids.lookupMaybe(i, PDFDict), out, depth + 1, seen)
  return out
}

/** All destinations as (name, raw value) pairs: the name tree first, then entries only the old dictionary has. */
function allPairs(doc: PDFDocument): [string, PDFObject][] {
  const out = treePairs(doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('Dests'), PDFDict))
  const have = new Set(out.map(([k]) => k))
  const old = doc.catalog.lookupMaybe(N('Dests'), PDFDict)
  for (const key of old?.keys() ?? []) {
    const k = key.decodeText()
    const value = old?.get(key)
    if (!have.has(k) && value !== undefined) out.push([k, value])
  }
  return out
}

/** The destination array behind a value (the array itself, or a dictionary's /D). */
function destArray(value: PDFObject | undefined): PDFArray | null {
  if (value instanceof PDFArray) return value
  if (value instanceof PDFDict) {
    const d = value.lookup(N('D'))
    return d instanceof PDFArray ? d : null
  }
  return null
}

function describe(doc: PDFDocument, name: string, raw: PDFObject, pageIndex: Map<number, number>): Destination {
  const arr = destArray(doc.context.lookup(raw))
  const dest: Destination = { name, page: -1, kind: 'other', left: null, top: null, zoom: null }
  if (!arr || arr.size() < 2) return dest
  const first = arr.get(0)
  if (first instanceof PDFRef) dest.page = pageIndex.get(first.objectNumber) ?? -1
  else if (first instanceof PDFNumber) dest.page = first.asNumber()
  const kind = arr.lookup(1)
  const k = kind instanceof PDFName ? kind.decodeText() : ''
  if (k === 'XYZ') {
    dest.kind = 'XYZ'
    dest.left = numOf(arr.lookup(2))
    dest.top = numOf(arr.lookup(3))
    const z = numOf(arr.lookup(4))
    dest.zoom = z !== null && z > 0 ? z : null
  } else if (k === 'FitH' || k === 'FitBH') {
    dest.kind = k
    dest.top = numOf(arr.lookup(2))
  } else if (k === 'FitV' || k === 'FitBV') {
    dest.kind = k
    dest.left = numOf(arr.lookup(2))
  } else if (k === 'Fit' || k === 'FitB' || k === 'FitR') dest.kind = k
  return dest
}

const pageIndexOf = (doc: PDFDocument) => new Map(doc.getPages().map((p, i) => [p.ref.objectNumber, i]))

/** The document's named destinations, in name order. */
export async function readDestinations(bytes: Uint8Array): Promise<Destination[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const idx = pageIndexOf(doc)
  return allPairs(doc)
    .map(([name, raw]) => describe(doc, name, raw, idx))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** A string for a name tree key: plain text when it is simple, else UTF-16 with a byte order mark. */
const keyString = (name: string) => (/^[\x20-\x7e]+$/.test(name) ? PDFString.of(name) : PDFHexString.fromText(name))

/** Writes the pairs back as one flat, sorted tree and drops the old dictionary. */
function writeAll(doc: PDFDocument, list: [string, PDFObject][]): void {
  const ctx = doc.context
  const sorted = [...list].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  let names = doc.catalog.lookupMaybe(N('Names'), PDFDict)
  doc.catalog.delete(N('Dests'))
  if (!sorted.length) {
    names?.delete(N('Dests'))
    return
  }
  if (!names) {
    names = ctx.obj({})
    doc.catalog.set(N('Names'), names)
  }
  const arr = ctx.obj([])
  for (const [k, v] of sorted) {
    arr.push(keyString(k))
    arr.push(v)
  }
  names.set(N('Dests'), ctx.obj({ Names: arr }))
}

function destValue(doc: PDFDocument, d: NewDestination): PDFObject {
  const pages = doc.getPages()
  const page = pages[Math.min(pages.length - 1, Math.max(0, Math.round(d.page)))]
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return doc.context.obj([page.ref, N('XYZ'), num(d.left), num(d.top), num(d.zoom)])
}

/** Adds a destination (the name must be new). */
export async function addDestination(bytes: Uint8Array, d: NewDestination): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  if (!doc.getPageCount()) throw new Error('The document has no pages.')
  const list = allPairs(doc)
  const problem = checkDestinationName(d.name, list.map(([k]) => k))
  if (problem) throw new Error(problem)
  list.push([d.name.trim(), destValue(doc, d)])
  writeAll(doc, list)
  return doc.save({ useObjectStreams: false })
}

/** Gives a destination another name; bookmarks and links that used the old name are not changed (the result says how many were). */
export async function renameDestination(bytes: Uint8Array, from: string, to: string): Promise<{ bytes: Uint8Array; orphaned: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const list = allPairs(doc)
  const at = list.findIndex(([k]) => k === from)
  if (at < 0) throw new Error('That destination is not in the document any more.')
  const problem = checkDestinationName(to, list.filter(([k]) => k !== from).map(([k]) => k))
  if (problem) throw new Error(problem)
  list[at] = [to.trim(), list[at][1]]
  writeAll(doc, list)
  return { bytes: await doc.save({ useObjectStreams: false }), orphaned: countUses(doc, from) }
}

/** Removes a destination; the result says how many bookmarks and links still point at the name. */
export async function deleteDestination(bytes: Uint8Array, name: string): Promise<{ bytes: Uint8Array; orphaned: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const list = allPairs(doc)
  const kept = list.filter(([k]) => k !== name)
  if (kept.length === list.length) throw new Error('That destination is not in the document any more.')
  writeAll(doc, kept)
  return { bytes: await doc.save({ useObjectStreams: false }), orphaned: countUses(doc, name) }
}

/** Moves an existing destination to a new position (keeps its name). */
export async function moveDestination(bytes: Uint8Array, name: string, to: Omit<NewDestination, 'name'>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const list = allPairs(doc)
  const at = list.findIndex(([k]) => k === name)
  if (at < 0) throw new Error('That destination is not in the document any more.')
  list[at] = [name, destValue(doc, { ...to, name })]
  writeAll(doc, list)
  return doc.save({ useObjectStreams: false })
}

/** Bookmarks and link annotations whose destination is this name (so a rename or delete can warn about them). */
function countUses(doc: PDFDocument, name: string): number {
  let n = 0
  const isName = (o: PDFObject | undefined) => textOf(o) === name
  const action = (a: PDFDict | undefined) => a?.lookupMaybe(N('S'), PDFName)?.decodeText() === 'GoTo' && isName(a.lookup(N('D')))
  const outlines = doc.catalog.lookupMaybe(N('Outlines'), PDFDict)
  const seen = new Set<PDFDict>()
  const walk = (first: PDFDict | undefined, depth: number) => {
    for (let node = first; node && !seen.has(node) && depth < 40; node = node.lookupMaybe(N('Next'), PDFDict)) {
      seen.add(node)
      if (isName(node.lookup(N('Dest'))) || action(node.lookupMaybe(N('A'), PDFDict))) n++
      walk(node.lookupMaybe(N('First'), PDFDict), depth + 1)
    }
  }
  walk(outlines?.lookupMaybe(N('First'), PDFDict), 0)
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    for (let i = 0; annots && i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict)
      if (a && (isName(a.lookup(N('Dest'))) || action(a.lookupMaybe(N('A'), PDFDict)))) n++
    }
  }
  return n
}
