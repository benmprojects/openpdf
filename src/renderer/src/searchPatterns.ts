/**
 * Search beyond plain text: regular expressions, whole words, pattern presets (phone numbers, e-mail addresses and so
 * on), and the same search over comments and bookmarks. Pure functions; no PDFium or DOM.
 */
import { msg } from './i18n'
import type { PageText } from './pdfiumRaw'
import type { Match } from './textLogic'

export interface SearchOpts {
  regex: boolean
  matchCase: boolean
  wholeWord: boolean
  /** Reject a match that looks right but is not (a check digit that fails). */
  validate?: (text: string) => boolean
}

export const PER_PAGE_LIMIT = 2000

const WORD = '[\\p{L}\\p{N}_]'

export interface Preset {
  id: string
  label: string
  pattern: string
  /** Checks a match; a number with a wrong check digit is not reported. */
  validate?: (text: string) => boolean
}

const digits = (s: string) => s.replace(/\D/g, '')

/** Luhn check: the check that card numbers pass. */
export function luhn(s: string): boolean {
  const d = digits(s)
  if (d.length < 13 || d.length > 19) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}

/** Australian Business Number check digit (11 digits: take 1 off the first, weight, divisible by 89). */
export function abnValid(s: string): boolean {
  const d = digits(s)
  if (d.length !== 11) return false
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
  const sum = [...d].reduce((a, c, i) => a + (Number(c) - (i === 0 ? 1 : 0)) * w[i], 0)
  return sum % 89 === 0
}

/** Australian Company Number check digit (9 digits). */
export function acnValid(s: string): boolean {
  const d = digits(s)
  if (d.length !== 9) return false
  const w = [8, 7, 6, 5, 4, 3, 2, 1]
  const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0)
  return (10 - (sum % 10)) % 10 === Number(d[8])
}

export const PRESETS: Preset[] = [
  {
    id: 'phone',
    label: msg('Phone numbers (Australian)'),
    pattern: String.raw`(?<![\d])(?:(?:\+61[ -]?|0)4\d{2}[ -]?\d{3}[ -]?\d{3}|(?:\+61[ -]?\(?0?\)?[ -]?|\(?0)[2378]\)?[ -]?\d{4}[ -]?\d{4}|1[38]00[ -]?\d{3}[ -]?\d{3}|13[ -]?\d{2}[ -]?\d{2})(?![\d])`
  },
  {
    id: 'email',
    label: msg('E-mail addresses'),
    pattern: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`
  },
  {
    id: 'date',
    label: msg('Dates'),
    pattern: String.raw`(?<![\d/.-])(?:\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{2,4})(?![\d/.-])`
  },
  {
    id: 'abn',
    label: msg('ABN (11 digits, check digit tested)'),
    pattern: String.raw`(?<!\d)\d{2} ?\d{3} ?\d{3} ?\d{3}(?!\d)`,
    validate: abnValid
  },
  {
    id: 'acn',
    label: msg('ACN (9 digits, check digit tested)'),
    pattern: String.raw`(?<!\d)\d{3} ?\d{3} ?\d{3}(?!\d)`,
    validate: acnValid
  },
  {
    id: 'card',
    label: msg('Card-like numbers (13 to 19 digits, Luhn tested)'),
    pattern: String.raw`(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)`,
    validate: luhn
  },
  {
    id: 'tfn',
    label: msg('TFN-like groups (3 x 3 digits)'),
    pattern: String.raw`(?<!\d)\d{3}[ -]\d{3}[ -]\d{3}(?!\d)`
  }
]

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id)

/** The regular expression for a query, or an error message when the pattern is not valid. */
export function buildRegex(query: string, opts: Pick<SearchOpts, 'regex' | 'matchCase' | 'wholeWord'>): { re: RegExp } | { error: string } {
  if (!query) return { error: 'Nothing to find' }
  const escaped = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = opts.wholeWord ? `(?<!${WORD})(?:${escaped})(?!${WORD})` : escaped
  try {
    return { re: new RegExp(body, opts.matchCase ? 'gu' : 'giu') }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Not a valid pattern'
    }
  }
}

/** Whether the query can be used as the search says (an invalid regular expression cannot). */
export function queryError(query: string, opts: Pick<SearchOpts, 'regex' | 'matchCase' | 'wholeWord'>): string | null {
  if (!query) return null
  const r = buildRegex(query, opts)
  return 'error' in r ? r.error : null
}

/** Every match of the query in a string, as [from, end) offsets. Empty matches are skipped. */
export function findInString(text: string, query: string, opts: SearchOpts, limit = PER_PAGE_LIMIT): { from: number; end: number }[] {
  const r = buildRegex(query, opts)
  if ('error' in r) return []
  const out: { from: number; end: number }[] = []
  r.re.lastIndex = 0
  for (let m = r.re.exec(text); m; m = r.re.exec(text)) {
    if (m[0].length === 0) {
      r.re.lastIndex++
      continue
    }
    if (opts.validate && !opts.validate(m[0])) {
      // A rejected match may still hide a valid one that starts later inside it.
      r.re.lastIndex = m.index + 1
      continue
    }
    out.push({ from: m.index, end: m.index + m[0].length })
    if (out.length >= limit) break
  }
  return out
}

/** Matches on a page, as character ranges. Handles regular expressions, whole words and case. */
export function findPattern(pt: PageText, page: number, query: string, opts: SearchOpts): Match[] {
  return findInString(pt.text, query, opts).map((m) => ({
    page,
    from: pt.charOf[m.from],
    to: pt.charOf[m.end - 1]
  }))
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ')

export interface Context {
  before: string
  match: string
  after: string
}

/** The words around a match on a page, on one line. */
export function contextOf(pt: PageText, m: Match, around = 40): Context {
  const a = Math.max(0, pt.charOf.indexOf(m.from))
  const b = Math.max(a, pt.charOf.lastIndexOf(m.to) + 1)
  return {
    before: oneLine(pt.text.slice(Math.max(0, a - around), a)),
    match: oneLine(pt.text.slice(a, b)),
    after: oneLine(pt.text.slice(b, b + around))
  }
}

/** Matches grouped by page, in page order. */
export function groupByPage<T extends { page: number }>(items: T[]): { page: number; items: T[] }[] {
  const map = new Map<number, T[]>()
  for (const it of items) (map.get(it.page) ?? map.set(it.page, []).get(it.page)!).push(it)
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([page, list]) => ({ page, items: list }))
}

export type SearchScope = 'text' | 'comments' | 'bookmarks' | 'all'

export interface ListHit extends Context {
  kind: 'text' | 'comment' | 'bookmark'
  page: number
  /** Text: where the match is on the page. */
  at?: Match
  /** Comment: the annotation id. */
  annotId?: number
  /** Bookmark: its title path, for example "Part A > Scope". */
  trail?: string
}

function snippet(text: string, from: number, end: number, around = 40): Context {
  return {
    before: oneLine(text.slice(Math.max(0, from - around), from)),
    match: oneLine(text.slice(from, end)),
    after: oneLine(text.slice(end, end + around))
  }
}

interface CommentLike {
  id: number
  page: number
  kind: string
  text: string
  author?: string
  replies?: { text: string }[]
}

/** Comments (their text and replies) that contain the query. Links and attachments are not comments. */
export function searchComments(annots: CommentLike[], query: string, opts: SearchOpts): ListHit[] {
  const out: ListHit[] = []
  for (const a of annots) {
    if (a.kind === 'link') continue
    const texts = [a.text, ...(a.replies ?? []).map((r) => r.text)]
    for (const t of texts) {
      const found = t ? findInString(t, query, opts, 1)[0] : undefined
      if (found) {
        out.push({
          kind: 'comment',
          page: a.page,
          annotId: a.id,
          ...snippet(t, found.from, found.end)
        })
        break
      }
    }
  }
  return out
}

interface OutlineLike {
  title: string
  page: number
  children: OutlineLike[]
}

/** Bookmarks whose title contains the query. */
export function searchBookmarks(outline: OutlineLike[], query: string, opts: SearchOpts): ListHit[] {
  const out: ListHit[] = []
  const walk = (list: OutlineLike[], trail: string[]) => {
    for (const n of list) {
      const found = findInString(n.title, query, opts, 1)[0]
      if (found)
        out.push({
          kind: 'bookmark',
          page: n.page,
          trail: [...trail, n.title].join(' > '),
          ...snippet(n.title, found.from, found.end)
        })
      walk(n.children, [...trail, n.title])
    }
  }
  walk(outline, [])
  return out
}

export interface PatternSpec {
  query: string
  opts: SearchOpts
}

/** Matches of several patterns over every page, in page order with overlapping ones merged. */
export async function collectMatches(
  pageText: (page: number) => Promise<PageText>,
  pageCount: number,
  specs: PatternSpec[],
  limit = 5000,
  isCancelled: () => boolean = () => false
): Promise<{ page: number; pt: PageText; m: Match }[]> {
  const out: { page: number; pt: PageText; m: Match }[] = []
  for (let p = 0; p < pageCount && out.length < limit; p++) {
    if (isCancelled()) break
    let pt: PageText
    try {
      pt = await pageText(p)
    } catch {
      continue
    }
    const found = specs.flatMap((s) => findPattern(pt, p, s.query, s.opts)).sort((a, b) => a.from - b.from || b.to - a.to)
    let lastTo = -1
    for (const m of found) {
      if (m.from <= lastTo) continue
      lastTo = m.to
      out.push({ page: p, pt, m })
    }
  }
  return out.slice(0, limit)
}
