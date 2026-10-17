// Combine files: the list, its ordering and the bookmarks of the result. Pure, so it is unit tested.
import type { BookmarkNode } from './outlineEdit'

export type CombineKind = 'pdf' | 'picture' | 'office'

export const PICTURE_EXT = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'gif', 'bmp', 'webp']
export const OFFICE_EXT = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']

export const extOf = (name: string) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? '').toLowerCase()

/** What a file is, by its extension; null when it cannot be combined. */
export function kindOf(name: string): CombineKind | null {
  const e = extOf(name)
  if (e === 'pdf') return 'pdf'
  if (PICTURE_EXT.includes(e)) return 'picture'
  if (OFFICE_EXT.includes(e)) return 'office'
  return null
}

export interface CombineItem {
  id: string
  name: string
  path: string
  kind: CombineKind
  size: number
  /** Last modified, milliseconds since 1970. */
  mtime: number
  /** Pages to take, such as "1-3, 5"; empty for all. Pictures are always one page. */
  range: string
}

export type SortBy = 'name' | 'date'

/** The list sorted by name (numbers in names count as numbers: "2" before "10") or by date, oldest first. */
export function sortItems<T extends Pick<CombineItem, 'name' | 'mtime'>>(items: T[], by: SortBy, descending = false): T[] {
  const sorted = [...items].sort((a, b) => (by === 'date' ? a.mtime - b.mtime || a.name.localeCompare(b.name, 'en', { numeric: true }) : a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' })))
  return descending ? sorted.reverse() : sorted
}

/** Moves the item at `from` so it ends up at index `to` (both clamped). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items
  const out = [...items]
  const [it] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it)
  return out
}

/** A bookmark title from a file name: no extension. */
export const bookmarkTitle = (name: string) => name.replace(/\.[^./\\]+$/, '') || name

/**
 * Carries a source file's bookmarks into the combined document. `selected` is the file's chosen pages (0-based, in
 * order); `offset` is where the first of them lands. A bookmark to a page that was left out goes, unless some of its
 * children survive, in which case it points at the first of them.
 */
export function remapOutline(nodes: BookmarkNode[], selected: number[], offset: number): BookmarkNode[] {
  const where = new Map<number, number>()
  selected.forEach((p, i) => where.set(p, offset + i))
  const walk = (list: BookmarkNode[]): BookmarkNode[] => {
    const out: BookmarkNode[] = []
    for (const n of list) {
      const children = walk(n.children)
      const page = where.get(n.page)
      if (page !== undefined) out.push({ title: n.title, page, children })
      else if (children.length) out.push({ title: n.title, page: children[0].page, children })
    }
    return out
  }
  return walk(nodes)
}

export interface OutlineEntry {
  name: string
  /** Page index in the result where this file starts. */
  offset: number
  /** Pages this file contributes. */
  pages: number[]
  /** Its own bookmarks, if they are to be kept. */
  outline: BookmarkNode[]
}

/** The bookmark tree of the combined document: a bookmark per file (named after it), and/or the files' own. */
export function buildOutline(entries: OutlineEntry[], perFile: boolean, keepOwn: boolean): BookmarkNode[] {
  const out: BookmarkNode[] = []
  for (const e of entries) {
    if (!e.pages.length) continue
    const own = keepOwn ? remapOutline(e.outline, e.pages, e.offset) : []
    if (perFile) out.push({ title: bookmarkTitle(e.name), page: e.offset, children: own })
    else out.push(...own)
  }
  return out
}

export const formatSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** DD/MM/YYYY */
export function formatDay(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}
