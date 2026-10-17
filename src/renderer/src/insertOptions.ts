/**
 * Insert pages with choices about what comes with them: only the odd or even pages of the source range, and what
 * happens to the inserted pages' comments, form fields and bookmarks.
 *
 * pdf-lib copies a page with its annotations, but a copied form field is not part of the new document's form, so by
 * default the fields would show without being fillable. "Keep" joins them to the form (renaming one whose name is
 * already used); "flatten" draws them into the page; "remove" leaves them out.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, StandardFonts } from 'pdf-lib'
import { remapOutline } from './combineLogic'
import { flattenForm } from './forms'
import { writeOutline, type BookmarkNode } from './outlineEdit'
import { readOutlineTree } from './outlineRead'
import { insertMany } from './pageOps'

export type SourceSubset = 'all' | 'odd' | 'even'

/**
 * The source pages to take, 0-based: `pages` (null for all) narrowed to the odd or even page numbers (page 1 is odd).
 * Returns null when nothing was narrowed and nothing was chosen, meaning every page.
 */
export function applySubset(pages: number[] | null, count: number, subset: SourceSubset): number[] | null {
  if (subset === 'all') return pages
  const base = pages ?? Array.from({ length: count }, (_, i) => i)
  return base.filter((i) => (subset === 'odd' ? i % 2 === 0 : i % 2 === 1))
}

export interface InsertKeep {
  /** Comments and markup on the inserted pages. */
  comments: 'keep' | 'remove'
  /** Form fields on the inserted pages. */
  fields: 'keep' | 'flatten' | 'remove'
  /** Bookmarks of the source file that point at the inserted pages. */
  bookmarks: 'keep' | 'remove'
}

export const DEFAULT_KEEP: InsertKeep = { comments: 'keep', fields: 'keep', bookmarks: 'remove' }

const textOf = (o: unknown): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** The top of a field's tree, reached through /Parent from a widget. */
function rootField(doc: PDFDocument, ref: PDFRef | undefined, dict: PDFDict): { ref: PDFRef | undefined; dict: PDFDict } {
  let curRef = ref
  let cur = dict
  for (let depth = 0; depth < 30; depth++) {
    const up = cur.get(PDFName.of('Parent'))
    if (!(up instanceof PDFRef)) break
    const parent = doc.context.lookupMaybe(up, PDFDict)
    if (!parent) break
    curRef = up
    cur = parent
  }
  return { ref: curRef, dict: cur }
}

/** Applies the comment and field choices to the pages [from, from + count) of `bytes`. */
export async function prepareInserted(bytes: Uint8Array, from: number, count: number, keep: Pick<InsertKeep, 'comments' | 'fields'>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const pages = doc.getPages()
  const roots = new Map<string, { ref: PDFRef; dict: PDFDict }>()
  let changed = false
  for (let p = from; p < Math.min(pages.length, from + count); p++) {
    const annots = pages[p].node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let j = annots.size() - 1; j >= 0; j--) {
      const raw = annots.get(j)
      const dict = annots.lookupMaybe(j, PDFDict)
      if (!dict) continue
      const subtype = dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText()
      if (subtype === 'Widget') {
        if (keep.fields === 'remove') {
          annots.remove(j)
          changed = true
        } else {
          const r = rootField(doc, raw instanceof PDFRef ? raw : undefined, dict)
          if (r.ref) roots.set(r.ref.tag, { ref: r.ref, dict: r.dict })
        }
      } else if (subtype !== 'Link' && keep.comments === 'remove') {
        annots.remove(j)
        changed = true
      }
    }
  }
  if (roots.size) {
    let form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    if (!form) {
      form = ctx.obj({}) as PDFDict
      doc.catalog.set(PDFName.of('AcroForm'), form)
    }
    let fields = form.lookupMaybe(PDFName.of('Fields'), PDFArray)
    if (!fields) {
      fields = ctx.obj([]) as PDFArray
      form.set(PDFName.of('Fields'), fields)
    }
    const have = new Set<string>()
    const names = new Set<string>()
    for (let i = 0; i < fields.size(); i++) {
      const e = fields.get(i)
      if (e instanceof PDFRef) have.add(e.tag)
      const d = fields.lookupMaybe(i, PDFDict)
      const t = textOf(d?.lookup(PDFName.of('T')))
      if (t) names.add(t)
    }
    for (const { ref, dict } of roots.values()) {
      if (have.has(ref.tag)) continue
      const t = textOf(dict.lookup(PDFName.of('T')))
      if (t && names.has(t)) {
        let k = 2
        while (names.has(`${t}_${k}`)) k++
        dict.set(PDFName.of('T'), PDFHexString.fromText(`${t}_${k}`))
        names.add(`${t}_${k}`)
      } else if (t) names.add(t)
      fields.push(ref)
      changed = true
    }
    // Fields need a default font to be edited: add Helvetica when the form has none.
    if (!form.has(PDFName.of('DA'))) form.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'))
    let dr = form.lookupMaybe(PDFName.of('DR'), PDFDict)
    if (!dr) {
      dr = ctx.obj({}) as PDFDict
      form.set(PDFName.of('DR'), dr)
    }
    let fonts = dr.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (!fonts) {
      fonts = ctx.obj({}) as PDFDict
      dr.set(PDFName.of('Font'), fonts)
    }
    if (!fonts.has(PDFName.of('Helv'))) fonts.set(PDFName.of('Helv'), (await doc.embedFont(StandardFonts.Helvetica)).ref)
  }
  let out = changed || roots.size ? await doc.save() : bytes
  if (keep.fields === 'flatten' && roots.size) {
    out = (await flattenForm(out, Array.from({ length: count }, (_, i) => from + i))).bytes
  }
  return out
}

/** Bookmark tree of `data` carried to where its pages land: the pages in `selected` (0-based) from `offset` on. */
async function sourceBookmarks(data: Uint8Array, selected: number[] | null, offset: number): Promise<BookmarkNode[]> {
  const tree = await readOutlineTree(data)
  if (!tree.length) return []
  const pages = selected ?? Array.from({ length: (await PDFDocument.load(data, { updateMetadata: false })).getPageCount() }, (_, i) => i)
  return remapOutline(tree, pages, offset)
}

const shift = (nodes: BookmarkNode[], at: number, by: number): BookmarkNode[] => nodes.map((n) => ({ ...n, page: n.page >= at ? n.page + by : n.page, children: shift(n.children, at, by) }))

/**
 * Inserts the items (each all of its pages, or `pages`) so the first lands at index `at`, then applies the choices.
 * Bookmarks of a source go into the top level of the document's bookmarks, in page order.
 */
export async function insertWithOptions(
  base: Uint8Array,
  at: number,
  items: { data: Uint8Array; pages: number[] | null }[],
  keep: InsertKeep
): Promise<{ bytes: Uint8Array; count: number }> {
  // Read the document's own bookmarks before the pages move, only when there is something to merge into them.
  const before = keep.bookmarks === 'keep' ? await readOutlineTree(base) : []
  const r = await insertMany(base, at, items)
  let bytes = r.bytes
  bytes = await prepareInserted(bytes, at, r.count, keep)
  if (keep.bookmarks === 'keep') {
    const added: BookmarkNode[] = []
    let offset = at
    for (const it of items) {
      const n = it.pages ? it.pages.length : (await PDFDocument.load(it.data, { updateMetadata: false })).getPageCount()
      added.push(...(await sourceBookmarks(it.data, it.pages, offset)))
      offset += n
    }
    if (added.length) {
      const own = shift(before, at, r.count)
      // Placed after the last top-level bookmark that points before the inserted pages.
      const place = own.reduce((last, n, i) => (n.page >= 0 && n.page < at ? i + 1 : last), 0)
      const merged = [...own.slice(0, place), ...added, ...own.slice(place)]
      bytes = await writeOutline(bytes, merged)
    }
  }
  return { bytes, count: r.count }
}
