/**
 * Reading bookmarks and named destinations straight from the file with pdf-lib (no PDFium), for work that needs the
 * tree of a document that is not open: bringing a source file's bookmarks along when its pages are inserted, and
 * checking which bookmarks point nowhere.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib'
import type { BookmarkNode } from './outlineEdit'

export interface NamedDestination {
  name: string
  /** Zero-based page, or -1 when the destination points at a page the file does not have. */
  page: number
}

const textOf = (o: PDFObject | undefined): string | null => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : null)

/** An explicit destination array: its page index (by reference), or -1. */
function pageOfDest(dest: PDFObject | undefined, pageIndex: Map<string, number>): number {
  if (!(dest instanceof PDFArray) || dest.size() < 1) return -1
  const first = dest.get(0)
  if (first instanceof PDFRef) return pageIndex.get(`${first.objectNumber}`) ?? -1
  if (first instanceof PDFNumber) return first.asNumber() // a page number, as a remote destination would have
  return -1
}

/** Walks a name tree (/Names pairs and /Kids), calling `visit` with each key and value. */
function walkNameTree(node: PDFDict | undefined, visit: (key: string, value: PDFObject | undefined) => void, depth = 0, seen = new Set<PDFDict>()): void {
  if (!node || depth > 20 || seen.has(node)) return
  seen.add(node)
  const names = node.lookupMaybe(PDFName.of('Names'), PDFArray)
  for (let i = 0; names && i + 1 < names.size(); i += 2) {
    const key = textOf(names.lookup(i))
    if (key !== null) visit(key, names.lookup(i + 1))
  }
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
  for (let i = 0; kids && i < kids.size(); i++) walkNameTree(kids.lookupMaybe(i, PDFDict), visit, depth + 1, seen)
}

function pageMap(doc: PDFDocument): Map<string, number> {
  return new Map(doc.getPages().map((p, i) => [`${p.ref.objectNumber}`, i]))
}

function namedMap(doc: PDFDocument, pageIndex: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  const resolve = (v: PDFObject | undefined): number => {
    const d = v instanceof PDFDict ? v.lookup(PDFName.of('D')) : v
    return pageOfDest(d, pageIndex)
  }
  // PDF 1.2 and later: the name tree under /Names.
  const tree = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('Dests'), PDFDict)
  walkNameTree(tree, (k, v) => out.set(k, resolve(v)))
  // PDF 1.1: a dictionary of names in the catalogue.
  const old = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict)
  for (const key of old?.keys() ?? []) if (!out.has(key.decodeText())) out.set(key.decodeText(), resolve(old!.lookup(key)))
  return out
}

/** The named destinations of a document, in name order. */
export async function readNamedDestinations(bytes: Uint8Array): Promise<NamedDestination[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  return [...namedMap(doc, pageMap(doc))].map(([name, page]) => ({ name, page })).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The document's bookmarks. A bookmark whose destination is a name gets that name in `named` and the page the name
 * leads to (-1 if the name is not defined). Colour, style and open state are read as well.
 */
export async function readOutlineTree(bytes: Uint8Array): Promise<BookmarkNode[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const pageIndex = pageMap(doc)
  const named = namedMap(doc, pageIndex)
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  const seen = new Set<PDFDict>()
  let budget = 20000
  const walk = (first: PDFDict | undefined, depth: number): BookmarkNode[] => {
    const out: BookmarkNode[] = []
    for (let n = first; n && !seen.has(n) && depth < 40 && budget-- > 0; n = n.lookupMaybe(PDFName.of('Next'), PDFDict)) {
      seen.add(n)
      const node: BookmarkNode = { title: textOf(n.lookup(PDFName.of('Title'))) ?? '', page: -1, children: [] }
      let dest = n.lookup(PDFName.of('Dest'))
      if (!dest) {
        const action = n.lookupMaybe(PDFName.of('A'), PDFDict)
        if (action?.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText() === 'GoTo') dest = action.lookup(PDFName.of('D'))
      }
      const name = textOf(dest)
      if (name !== null) {
        node.named = name
        node.page = named.get(name) ?? -1
      } else {
        node.page = pageOfDest(dest, pageIndex)
        if (dest instanceof PDFArray && dest.size() >= 4 && dest.lookup(1) instanceof PDFName && (dest.lookup(1) as PDFName).decodeText() === 'XYZ') {
          const l = dest.lookup(2)
          const t = dest.lookup(3)
          const left = l instanceof PDFNumber ? l.asNumber() : null
          const top = t instanceof PDFNumber ? t.asNumber() : null
          if (left !== null || top !== null) node.dest = { left, top }
        }
      }
      const f = n.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0
      if (f & 1) node.italic = true
      if (f & 2) node.bold = true
      const c = n.lookupMaybe(PDFName.of('C'), PDFArray)
      if (c && c.size() >= 3) {
        const v = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round((c.lookupMaybe(i, PDFNumber)?.asNumber() ?? 0) * 255))))
        const hex = '#' + v.map((x) => x.toString(16).padStart(2, '0')).join('')
        if (hex !== '#000000') node.color = hex
      }
      if ((n.lookupMaybe(PDFName.of('Count'), PDFNumber)?.asNumber() ?? 0) > 0) node.open = true
      node.children = walk(n.lookupMaybe(PDFName.of('First'), PDFDict), depth + 1)
      out.push(node)
    }
    return out
  }
  return walk(root?.lookupMaybe(PDFName.of('First'), PDFDict), 0)
}
