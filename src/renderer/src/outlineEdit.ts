/**
 * Bookmark (outline) and page label editing. The tree is edited as plain data, then written back with pdf-lib
 * as a fresh /Outlines tree (ISO 32000 12.3.3) or /PageLabels number tree (12.4.2).
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, type PDFRef } from 'pdf-lib'
import { frameFor } from './annotWrite'

/** What a bookmark can show beyond its title (ISO 32000 12.3.3: /C colour, /F style flags). */
export interface OutlineStyle {
  bold?: boolean
  italic?: boolean
  /** `#rrggbb`; the viewer's default (black) when unset. */
  color?: string
  /** Shown open (children visible) when the file is opened. */
  open?: boolean
  /** Destination as read from the file, in user space; kept as it is unless `view` is set. */
  dest?: { left: number | null; top: number | null }
  /** A destination set here: a point on the page in points from the top-left of the page as shown. Wins over `dest`. */
  view?: { x: number; y: number }
}

export interface BookmarkNode extends OutlineStyle {
  title: string
  /** Zero-based target page, or -1 for a bookmark without a page. */
  page: number
  children: BookmarkNode[]
}

/** A bookmark's place in the tree: indices from the top level down. */
export type Path = number[]

const clone = (t: BookmarkNode[]): BookmarkNode[] => t.map((n) => ({ ...n, children: clone(n.children) }))

function parentOf(tree: BookmarkNode[], path: Path): BookmarkNode[] {
  let list = tree
  for (const i of path.slice(0, -1)) list = list[i].children
  return list
}

export function nodeAt(tree: BookmarkNode[], path: Path): BookmarkNode | undefined {
  let list = tree
  let node: BookmarkNode | undefined
  for (const i of path) {
    node = list[i]
    if (!node) return undefined
    list = node.children
  }
  return node
}

/** Inserts `node` after `path` (or at the end of the top level when `path` is empty). Returns the tree and new path. */
export function insertAfter(tree: BookmarkNode[], path: Path, node: BookmarkNode): { tree: BookmarkNode[]; path: Path } {
  const t = clone(tree)
  if (!path.length) {
    t.push(node)
    return { tree: t, path: [t.length - 1] }
  }
  const list = parentOf(t, path)
  const at = path[path.length - 1] + 1
  list.splice(at, 0, node)
  return { tree: t, path: [...path.slice(0, -1), at] }
}

export function removeAt(tree: BookmarkNode[], path: Path): BookmarkNode[] {
  const t = clone(tree)
  parentOf(t, path).splice(path[path.length - 1], 1)
  return t
}

export function updateAt(tree: BookmarkNode[], path: Path, patch: Partial<BookmarkNode>): BookmarkNode[] {
  const t = clone(tree)
  const list = parentOf(t, path)
  const i = path[path.length - 1]
  list[i] = { ...list[i], ...patch }
  return t
}

/** Moves a bookmark up or down among its siblings. */
export function moveAt(tree: BookmarkNode[], path: Path, dir: -1 | 1): { tree: BookmarkNode[]; path: Path } {
  const t = clone(tree)
  const list = parentOf(t, path)
  const i = path[path.length - 1]
  const j = i + dir
  if (j < 0 || j >= list.length) return { tree, path }
  ;[list[i], list[j]] = [list[j], list[i]]
  return { tree: t, path: [...path.slice(0, -1), j] }
}

/** Makes a bookmark the last child of the sibling above it. */
export function indentAt(tree: BookmarkNode[], path: Path): { tree: BookmarkNode[]; path: Path } {
  const i = path[path.length - 1]
  if (i === 0) return { tree, path }
  const t = clone(tree)
  const list = parentOf(t, path)
  const [node] = list.splice(i, 1)
  const above = list[i - 1]
  above.children.push(node)
  return { tree: t, path: [...path.slice(0, -1), i - 1, above.children.length - 1] }
}

/** Moves a bookmark out of its parent, to just after the parent. */
export function outdentAt(tree: BookmarkNode[], path: Path): { tree: BookmarkNode[]; path: Path } {
  if (path.length < 2) return { tree, path }
  const t = clone(tree)
  const list = parentOf(t, path)
  const [node] = list.splice(path[path.length - 1], 1)
  const parentPath = path.slice(0, -1)
  const grand = parentOf(t, parentPath)
  const at = parentPath[parentPath.length - 1] + 1
  grand.splice(at, 0, node)
  return { tree: t, path: [...parentPath.slice(0, -1), at] }
}

/** Replaces the document's bookmarks with `tree`. Each bookmark goes to the top of its page. */
export async function writeOutline(bytes: Uint8Array, tree: BookmarkNode[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const pageRefs = doc.getPages().map((p) => p.ref)
  if (!tree.length) {
    doc.catalog.delete(PDFName.of('Outlines'))
    return doc.save()
  }
  const root = ctx.register(ctx.obj({ Type: 'Outlines' }))
  /** Writes a list of siblings under `parent`; returns [first, last, items visible when the parent is open]. */
  const writeList = (list: BookmarkNode[], parent: PDFRef): [PDFRef, PDFRef, number] => {
    const refs = list.map(() => ctx.nextRef())
    let count = 0
    list.forEach((n, i) => {
      const dict: Record<string, unknown> = { Title: PDFHexString.fromText(n.title), Parent: parent }
      if (i > 0) dict.Prev = refs[i - 1]
      if (i < list.length - 1) dict.Next = refs[i + 1]
      if (n.page >= 0 && n.page < pageRefs.length) {
        const at = n.view ? viewToUser(doc, n.page, n.view) : n.dest ? [n.dest.left, n.dest.top] : [null, null]
        dict.Dest = [pageRefs[n.page], 'XYZ', at[0], at[1], null]
      }
      if (n.color && /^#[0-9a-f]{6}$/i.test(n.color)) {
        const v = parseInt(n.color.slice(1), 16)
        dict.C = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
      }
      const flags = (n.italic ? 1 : 0) | (n.bold ? 2 : 0)
      if (flags) dict.F = flags
      let shown = 0
      if (n.children.length) {
        const [first, last, kids] = writeList(n.children, refs[i])
        dict.First = first
        dict.Last = last
        // Negative: closed, showing none of its descendants until opened.
        dict.Count = n.open ? kids : -kids
        shown = n.open ? kids : 0
      }
      ctx.assign(refs[i], ctx.obj(dict as never))
      count += 1 + shown
    })
    return [refs[0], refs[refs.length - 1], count]
  }
  const [first, last, count] = writeList(tree, root)
  const rootDict = ctx.lookup(root) as PDFDict
  rootDict.set(PDFName.of('First'), first)
  rootDict.set(PDFName.of('Last'), last)
  rootDict.set(PDFName.of('Count'), ctx.obj(count))
  doc.catalog.set(PDFName.of('Outlines'), root)
  return doc.save()
}

/** A point on a page, in points from its top-left as shown, as a point in the page's user space. */
function viewToUser(doc: PDFDocument, page: number, at: { x: number; y: number }): [number, number] {
  const p = doc.getPage(page)
  const cb = p.getCropBox()
  const m = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, p.getRotation().angle).m
  const r = (v: number) => Math.round(v * 100) / 100
  return [r(m[0] * at.x + m[2] * at.y + m[4]), r(m[1] * at.x + m[3] * at.y + m[5])]
}

// ---- Page labels -----------------------------------------------------------------------------------------------

export type LabelStyle = 'D' | 'R' | 'r' | 'A' | 'a' | ''

export interface LabelRange {
  /** Zero-based first page of the range. */
  start: number
  /** D 1 2 3, R I II, r i ii, A A B, a a b, or none (prefix only). */
  style: LabelStyle
  prefix: string
  /** Number of the range's first page. */
  first: number
}

export async function readLabelRanges(bytes: Uint8Array): Promise<LabelRange[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const tree = doc.catalog.lookupMaybe(PDFName.of('PageLabels'), PDFDict)
  const out: LabelRange[] = []
  const walk = (node: PDFDict | undefined, depth: number) => {
    if (!node || depth > 20) return
    const nums = node.lookupMaybe(PDFName.of('Nums'), PDFArray)
    for (let i = 0; nums && i + 1 < nums.size(); i += 2) {
      const start = nums.lookupMaybe(i, PDFNumber)?.asNumber()
      const d = nums.lookupMaybe(i + 1, PDFDict)
      if (start === undefined || !d) continue
      const p = d.lookup(PDFName.of('P'))
      out.push({
        start,
        style: (d.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText() ?? '') as LabelStyle,
        prefix: p instanceof PDFString || p instanceof PDFHexString ? p.decodeText() : '',
        first: d.lookupMaybe(PDFName.of('St'), PDFNumber)?.asNumber() ?? 1
      })
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
    for (let i = 0; kids && i < kids.size(); i++) walk(kids.lookupMaybe(i, PDFDict), depth + 1)
  }
  walk(tree, 0)
  return out.sort((a, b) => a.start - b.start)
}

/** Replaces the page labels; an empty list removes them (pages are then numbered 1, 2, 3 …). */
export async function writeLabelRanges(bytes: Uint8Array, ranges: LabelRange[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const n = doc.getPageCount()
  const clean = [...ranges].filter((r) => r.start >= 0 && r.start < n).sort((a, b) => a.start - b.start)
  if (!clean.length) {
    doc.catalog.delete(PDFName.of('PageLabels'))
    return doc.save()
  }
  if (clean[0].start !== 0) clean.unshift({ start: 0, style: 'D', prefix: '', first: 1 })
  const nums: unknown[] = []
  for (const r of clean) {
    const d: Record<string, unknown> = {}
    if (r.style) d.S = r.style
    if (r.prefix) d.P = PDFHexString.fromText(r.prefix)
    if (r.first !== 1) d.St = Math.max(1, Math.round(r.first))
    nums.push(r.start, d)
  }
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: nums } as never))
  return doc.save()
}

/** What a label range shows for a page, matching what PDF viewers print. */
export function labelFor(r: LabelRange, page: number): string {
  const v = r.first + (page - r.start)
  const roman = (x: number) => {
    const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
    let s = ''
    for (const [k, c] of t)
      while (x >= k) {
        s += c
        x -= k
      }
    return s
  }
  const letters = (x: number) => String.fromCharCode(65 + ((x - 1) % 26)).repeat(Math.floor((x - 1) / 26) + 1)
  const body = r.style === 'D' ? String(v) : r.style === 'R' ? roman(v) : r.style === 'r' ? roman(v).toLowerCase() : r.style === 'A' ? letters(v) : r.style === 'a' ? letters(v).toLowerCase() : ''
  return r.prefix + body
}
