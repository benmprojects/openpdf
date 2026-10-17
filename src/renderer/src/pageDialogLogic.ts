import { bookmarkRanges, parsePageRanges } from './pageOps'

/** Pure logic behind the page-operation dialogs: range presets, insert positions, sizes, file names, split plans. */

export type RangePreset = 'all' | 'current' | 'selected' | 'odd' | 'even' | 'landscape' | 'portrait' | 'custom'

export interface RangeValue {
  preset: RangePreset
  custom: string
}

export interface DocContext {
  count: number
  /** 0-based current page. */
  current: number
  /** 0-based pages selected in the thumbnails (may be empty). */
  selected: number[]
  sizes: { width: number; height: number }[]
}

export const ALL_PRESETS: RangePreset[] = ['all', 'current', 'selected', 'odd', 'even', 'landscape', 'portrait', 'custom']

/** [0,1,2,4] -> "1-3, 5" */
export function compactRanges(pages: number[]): string {
  const out: string[] = []
  for (let i = 0; i < pages.length; ) {
    let j = i
    while (pages[j + 1] === pages[j] + 1) j++
    out.push(j > i ? `${pages[i] + 1}-${pages[j] + 1}` : String(pages[i] + 1))
    i = j + 1
  }
  return out.join(', ')
}

/** The 0-based pages a range choice stands for, or the reason it stands for none. */
export function resolveRange(v: RangeValue, ctx: DocContext): { pages: number[]; error: string | null } {
  const all = Array.from({ length: ctx.count }, (_, i) => i)
  const pick = (pages: number[], none: string) => (pages.length ? { pages, error: null } : { pages, error: none })
  switch (v.preset) {
    case 'all':
      return pick(all, 'The document has no pages.')
    case 'current':
      return pick(ctx.current >= 0 && ctx.current < ctx.count ? [ctx.current] : [], 'There is no current page.')
    case 'selected': {
      const sel = [...new Set(ctx.selected)].filter((i) => i >= 0 && i < ctx.count).sort((a, b) => a - b)
      return pick(sel, 'No pages are selected in the thumbnails.')
    }
    case 'odd':
      return pick(all.filter((i) => i % 2 === 0), 'There are no odd-numbered pages.')
    case 'even':
      return pick(all.filter((i) => i % 2 === 1), 'There are no even-numbered pages.')
    case 'landscape':
      return pick(all.filter((i) => ctx.sizes[i] && ctx.sizes[i].width > ctx.sizes[i].height), 'There are no landscape pages in this document.')
    case 'portrait':
      return pick(all.filter((i) => ctx.sizes[i] && ctx.sizes[i].width <= ctx.sizes[i].height), 'There are no portrait pages in this document.')
    case 'custom':
      try {
        return { pages: parsePageRanges(v.custom, ctx.count), error: null }
      } catch (e) {
        return { pages: [], error: e instanceof Error ? e.message : String(e) }
      }
  }
}

/** Where a new dialog's range control starts: the thumbnail selection if there is one, else the current page. */
export function initialRange(ctx: DocContext): RangeValue {
  return { preset: ctx.selected.length ? 'selected' : 'current', custom: compactRanges(ctx.selected.length ? ctx.selected : [Math.max(0, ctx.current)]) }
}

/** Source-file page text: empty means every page. */
export function parseSourceRange(text: string, count: number): { pages: number[] | null; error: string | null } {
  if (!text.trim()) return { pages: null, error: null }
  try {
    return { pages: parsePageRanges(text, count), error: null }
  } catch (e) {
    return { pages: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export const pagesWord = (n: number) => `${n} page${n === 1 ? '' : 's'}`

// ---- Insert -------------------------------------------------------------------------------------------

export interface InsertWhere {
  side: 'before' | 'after'
  target: 'first' | 'last' | 'page'
  /** 1-based, used when target is 'page'. */
  page: number
}

/** The index the first inserted page takes, and a description such as "after page 3". */
export function insertIndex(w: InsertWhere, count: number): { index: number; text: string; error: string | null } {
  let page: number
  if (w.target === 'first') page = 1
  else if (w.target === 'last') page = count
  else page = w.page
  if (!Number.isInteger(page) || page < 1 || page > count) return { index: 0, text: '', error: `Enter a page number from 1 to ${count}.` }
  return { index: w.side === 'before' ? page - 1 : page, text: `${w.side} page ${page}`, error: null }
}

// ---- Blank pages --------------------------------------------------------------------------------------

export type PaperKind = 'same' | 'a4' | 'a3' | 'letter' | 'legal' | 'custom'
export const PAPER_MM: Record<Exclude<PaperKind, 'same' | 'custom'>, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
  letter: { w: 215.9, h: 279.4 },
  legal: { w: 215.9, h: 355.6 }
}
export const mmToPt = (mm: number) => (mm * 72) / 25.4

/** Size in points of a blank page. `same` keeps the current page's size and ignores orientation. */
export function blankPageSize(
  kind: PaperKind,
  orientation: 'portrait' | 'landscape',
  current: { width: number; height: number } | undefined,
  custom: { w: number; h: number }
): { width: number; height: number; error: string | null } {
  if (kind === 'same') {
    if (!current) return { width: 0, height: 0, error: 'There is no current page to copy the size from.' }
    return { width: current.width, height: current.height, error: null }
  }
  const mm = kind === 'custom' ? custom : PAPER_MM[kind]
  if (!(mm.w >= 10 && mm.h >= 10 && mm.w <= 5000 && mm.h <= 5000)) return { width: 0, height: 0, error: 'Enter a width and height between 10 and 5000 mm.' }
  const a = mmToPt(Math.min(mm.w, mm.h))
  const b = mmToPt(Math.max(mm.w, mm.h))
  return orientation === 'portrait' ? { width: a, height: b, error: null } : { width: b, height: a, error: null }
}

// ---- File names ---------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
export const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80)

export interface NameVars {
  name: string
  first: number
  last: number
  n: number
  total: number
  title?: string
}

/** Expands {name} {first} {last} {n} {title} {label} (the title, or "pages a-b") in a file name pattern; adds .pdf. */
export function expandPattern(pattern: string, v: NameVars): string {
  const width = String(v.total).length
  const label = v.title ? v.title : v.first === v.last ? `page ${v.first}` : `pages ${v.first}-${v.last}`
  const stem = pattern
    .replace(/\.pdf$/i, '')
    .replace(/\{(name|first|last|n|title|label)\}/g, (_m, k: string) => {
      switch (k) {
        case 'name':
          return v.name
        case 'first':
          return String(v.first)
        case 'last':
          return String(v.last)
        case 'n':
          return String(v.n).padStart(width, '0')
        case 'title':
          return v.title ?? ''
        default:
          return label
      }
    })
  return `${safeName(stem) || 'document'}.pdf`
}

/** Why a pattern cannot name `files` files, or null. */
export function patternProblem(pattern: string, files: number): string | null {
  if (!pattern.trim()) return 'Enter a file name pattern.'
  if (files > 1 && !/\{(first|last|n|title|label)\}/.test(pattern)) return 'Add {n}, {first} or {label} to the pattern so each file gets its own name.'
  return null
}

// ---- Split --------------------------------------------------------------------------------------------

export type SplitMode = 'count' | 'bookmarks' | 'size' | 'at'
export interface SplitRange {
  first: number
  last: number
  title?: string
}

/** Ranges (1-based, inclusive) for the modes that can be planned without building files; size returns null. */
export function planSplit(
  mode: SplitMode,
  value: string,
  count: number,
  bookmarks: { title: string; page: number }[]
): { ranges: SplitRange[] | null; error: string | null } {
  if (mode === 'count') {
    const every = Number(value)
    if (!Number.isInteger(every) || every < 1) return { ranges: [], error: 'Enter a whole number of pages per file, 1 or more.' }
    const out: SplitRange[] = []
    for (let s = 1; s <= count; s += every) out.push({ first: s, last: Math.min(count, s + every - 1) })
    return { ranges: out, error: null }
  }
  if (mode === 'bookmarks') {
    if (!bookmarks.length) return { ranges: [], error: 'This document has no bookmarks to split by.' }
    return { ranges: bookmarkRanges(bookmarks, count), error: null }
  }
  if (mode === 'at') {
    const nums = value
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map(Number)
    if (!nums.length) return { ranges: [], error: 'Enter the page numbers where each new file starts, for example 4, 7.' }
    if (nums.some((n) => !Number.isInteger(n) || n < 2 || n > count)) return { ranges: [], error: `Each page number must be from 2 to ${count}.` }
    const starts = [1, ...[...new Set(nums)].sort((a, b) => a - b)]
    return { ranges: starts.map((s, i) => ({ first: s, last: i + 1 < starts.length ? starts[i + 1] - 1 : count })), error: null }
  }
  const mb = parseFloat(value.replace(',', '.'))
  if (!(mb > 0)) return { ranges: null, error: 'Enter the largest file size in MB, for example 5.' }
  return { ranges: null, error: null }
}

// ---- Move ---------------------------------------------------------------------------------------------

export type MoveDest = { kind: 'before' | 'after'; page: number } | { kind: 'start' } | { kind: 'end' }

/** The `before` index for movePages, or why the move is not possible or changes nothing. */
export function moveTarget(dest: MoveDest, pages: number[], count: number): { before: number; error: string | null } {
  const moving = new Set(pages)
  let before: number
  if (dest.kind === 'start') before = 0
  else if (dest.kind === 'end') before = count
  else {
    if (!Number.isInteger(dest.page) || dest.page < 1 || dest.page > count) return { before: 0, error: `Enter a page number from 1 to ${count}.` }
    if (moving.has(dest.page - 1)) return { before: 0, error: 'The destination page is one of the pages being moved.' }
    before = dest.kind === 'before' ? dest.page - 1 : dest.page
  }
  const keep = Array.from({ length: count }, (_, i) => i).filter((i) => !moving.has(i))
  const at = keep.filter((i) => i < before).length
  const order = [...keep.slice(0, at), ...[...moving].sort((a, b) => a - b), ...keep.slice(at)]
  if (order.every((p, i) => p === i)) return { before, error: 'The pages are already there.' }
  return { before, error: null }
}

// ---- What a dialog hands back -------------------------------------------------------------------------

export interface SourceItem {
  data: Uint8Array
  /** 0-based pages to take, or null for all. */
  pages: number[] | null
}

export type PageDialogResult =
  | { kind: 'insert'; at: number; count: number; items: SourceItem[]; blank: { count: number; width: number; height: number } | null }
  | { kind: 'extract'; pages: number[]; deleteAfter: boolean; openAfter: boolean; each: { pattern: string; dir: string | null } | null }
  | { kind: 'delete'; pages: number[] }
  | { kind: 'rotate'; pages: number[]; delta: 90 | -90 | 180 }
  | { kind: 'replace'; pages: number[]; other: { name: string; data: Uint8Array }; theirs: number[] }
  | { kind: 'split'; mode: SplitMode; value: string; ranges: SplitRange[] | null; pattern: string; dir: string | null }
  | { kind: 'merge'; items: SourceItem[]; includeThis: boolean; at: number; count: number }
  | { kind: 'duplicate'; pages: number[]; copies: number; where: 'block' | 'each' | 'end' }
  | { kind: 'move'; pages: number[]; before: number }
  | { kind: 'swap'; a: number; b: number }

/** `deleteBlank` is a dialog that hands back a plain delete. */
export type PageDialogKind = PageDialogResult['kind'] | 'deleteBlank'
