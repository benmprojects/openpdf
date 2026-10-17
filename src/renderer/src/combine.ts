// Combine files: turns each listed file into PDF pages and joins them, reusing the picture, merge and bookmark code.
import { PDFDocument } from 'pdf-lib'
import { buildOutline, type CombineItem, type OutlineEntry } from './combineLogic'
import { imagesToPdf, type PageSizeChoice } from './createPdf'
import { writeOutline, type BookmarkNode } from './outlineEdit'
import { mergeDocuments, parsePageRanges } from './pageOps'

export interface CombineIo {
  read: (path: string) => Promise<Uint8Array>
  office: (path: string) => Promise<Uint8Array>
  /** A PDF's own bookmarks. */
  outline: (pdf: Uint8Array) => Promise<BookmarkNode[]>
}

export interface CombineOptions {
  bookmarkPerFile: boolean
  keepBookmarks: boolean
  pictureSize: Extract<PageSizeChoice, 'a4' | 'image'>
}

/** The PDF for one list entry: PDFs as they are, pictures one per page, Office files through the converter. */
export async function itemToPdf(item: CombineItem, opts: Pick<CombineOptions, 'pictureSize'>, io: Pick<CombineIo, 'read' | 'office'>): Promise<Uint8Array> {
  if (item.kind === 'office') return io.office(item.path)
  const data = await io.read(item.path)
  return item.kind === 'picture' ? imagesToPdf([{ name: item.name, data }], opts.pictureSize) : data
}

/** Checks a page range against a file's page count: the 0-based pages, or an error to show. */
export function pagesFor(range: string, count: number): { pages: number[]; error: string | null } {
  const text = range.trim()
  if (!text) return { pages: Array.from({ length: count }, (_, i) => i), error: null }
  try {
    return { pages: parsePageRanges(text, count), error: null }
  } catch (e) {
    return { pages: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/** Joins the files in list order. Returns the combined PDF and its page count. */
export async function combineFiles(items: CombineItem[], opts: CombineOptions, io: CombineIo): Promise<{ bytes: Uint8Array; count: number }> {
  const parts: { data: Uint8Array; pages: number[] }[] = []
  const entries: OutlineEntry[] = []
  let offset = 0
  for (const item of items) {
    try {
      const data = await itemToPdf(item, opts, io)
      const count = (await PDFDocument.load(data, { updateMetadata: false })).getPageCount()
      const { pages, error } = item.kind === 'picture' ? { pages: [0], error: null } : pagesFor(item.range, count)
      if (error) throw new Error(error)
      const outline = opts.keepBookmarks && item.kind !== 'picture' ? await io.outline(data).catch(() => []) : []
      parts.push({ data, pages })
      entries.push({ name: item.name, offset, pages, outline })
      offset += pages.length
    } catch (e) {
      throw new Error(`${item.name}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
  }
  const merged = await mergeDocuments(parts)
  const tree = buildOutline(entries, opts.bookmarkPerFile, opts.keepBookmarks)
  return { bytes: tree.length ? await writeOutline(merged.bytes, tree) : merged.bytes, count: merged.count }
}
