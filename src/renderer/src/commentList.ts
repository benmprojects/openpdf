/** Pure logic behind the Comments pane: filtering, sorting, grouping and stepping through the comments. */
import { annotLabel, formatWhen, isChecked, isLocked, reviewState, type Annot, type ReviewState } from './annotations'

export type SortKey = 'page' | 'date' | 'author' | 'type' | 'status' | 'subject'
export type GroupKey = 'none' | 'page' | 'author' | 'type' | 'colour' | 'date' | 'status' | 'subject' | 'checked'

export interface CommentFilter {
  query: string
  kind: string
  author: string
  status: string
  /** `#rrggbb`, or empty for any. */
  colour: string
  /** 'yes' for ticked comments only, 'no' for those not ticked, empty for both. */
  checked?: '' | 'yes' | 'no'
  /** An exact subject; the value `NO_SUBJECT` matches comments without one. Empty for any. */
  subject?: string
}

export const NO_FILTER: CommentFilter = { query: '', kind: '', author: '', status: '', colour: '', checked: '', subject: '' }
/** Filter value for "no subject". */
export const NO_SUBJECT = '\u0000none'

/** Text an annotation shows in the list: its comment, or for a stamp or measurement its label. */
export function commentText(a: Annot): string {
  if (a.measure) return a.measure.label
  if (a.kind === 'stamp') return a.text + (a.stampInfo ? ` (${a.stampInfo})` : '')
  return a.text
}

export function filterComments(annots: Annot[], f: CommentFilter): Annot[] {
  const q = f.query.trim().toLowerCase()
  return annots.filter(
    (a) =>
      (!f.kind || a.kind === f.kind) &&
      (!f.author || (a.author ?? '') === f.author) &&
      (!f.status || reviewState(a) === f.status) &&
      (!f.colour || a.color.toLowerCase() === f.colour.toLowerCase()) &&
      (!f.checked || isChecked(a) === (f.checked === 'yes')) &&
      (!f.subject || (f.subject === NO_SUBJECT ? !a.subject : a.subject === f.subject)) &&
      (!q || (a.subject ?? '').toLowerCase().includes(q) || commentText(a).toLowerCase().includes(q) || (a.author ?? '').toLowerCase().includes(q) || (a.replies ?? []).some((r) => r.text.toLowerCase().includes(q)))
  )
}

const STATUS_ORDER: ReviewState[] = ['None', 'Accepted', 'Completed', 'Rejected', 'Cancelled']
const when = (a: Annot) => a.modified ?? a.created ?? ''

export function sortComments(list: Annot[], sort: SortKey): Annot[] {
  const byPos = (x: Annot, y: Annot) => x.page - y.page || (x.rects[0]?.y ?? 0) - (y.rects[0]?.y ?? 0) || (x.rects[0]?.x ?? 0) - (y.rects[0]?.x ?? 0)
  const by: Record<SortKey, (x: Annot, y: Annot) => number> = {
    page: byPos,
    date: (x, y) => when(y).localeCompare(when(x)) || byPos(x, y),
    author: (x, y) => (x.author ?? '').localeCompare(y.author ?? '') || byPos(x, y),
    type: (x, y) => annotLabel(x.kind).localeCompare(annotLabel(y.kind)) || byPos(x, y),
    status: (x, y) => STATUS_ORDER.indexOf(reviewState(x)) - STATUS_ORDER.indexOf(reviewState(y)) || byPos(x, y),
    subject: (x, y) => (x.subject ?? '').localeCompare(y.subject ?? '') || byPos(x, y)
  }
  return [...list].sort(by[sort])
}

export interface CommentGroup {
  key: string
  label: string
  items: Annot[]
}

/** The key and heading of the group a comment falls in. */
function groupOf(a: Annot, by: Exclude<GroupKey, 'none'>, pageName: (p: number) => string): { key: string; label: string } {
  switch (by) {
    case 'page':
      return { key: String(a.page).padStart(6, '0'), label: pageName(a.page) }
    case 'author':
      return { key: a.author ?? '', label: a.author || '(no author)' }
    case 'type':
      return { key: annotLabel(a.kind), label: annotLabel(a.kind) }
    case 'colour':
      return { key: a.color.toLowerCase(), label: a.color.toUpperCase() }
    case 'subject':
      return { key: a.subject ?? '', label: a.subject || '(no subject)' }
    case 'checked':
      return isChecked(a) ? { key: '0', label: 'Checked' } : { key: '1', label: 'Not checked' }
    case 'status': {
      const s = reviewState(a)
      return { key: String(STATUS_ORDER.indexOf(s)), label: s === 'None' ? 'No status' : s }
    }
    case 'date': {
      // One group per day.
      const iso = when(a)
      const day = formatWhen(iso).slice(0, 10)
      return { key: iso ? iso.slice(0, 10) : '', label: day || '(no date)' }
    }
  }
}

/** Groups already-sorted comments, keeping their order inside each group. */
export function groupComments(list: Annot[], by: GroupKey, pageName: (p: number) => string): CommentGroup[] {
  if (by === 'none') return [{ key: '', label: '', items: list }]
  const groups = new Map<string, CommentGroup>()
  for (const a of list) {
    const g = groupOf(a, by, pageName)
    const existing = groups.get(g.key)
    if (existing) existing.items.push(a)
    else groups.set(g.key, { key: g.key, label: g.label, items: [a] })
  }
  const out = [...groups.values()]
  // Days newest first; everything else in key order (pages by number, statuses in their usual order).
  out.sort((x, y) => (by === 'date' ? y.key.localeCompare(x.key) : x.key.localeCompare(y.key)))
  return out
}

/** Every comment in the order the pane shows it, groups flattened. */
export const flatten = (groups: CommentGroup[]): Annot[] => groups.flatMap((g) => g.items)

/**
 * The comment after (`dir` 1) or before (`dir` -1) `current` in `order`, wrapping round at the ends. With nothing
 * current it is the first or the last. Null when there are no comments.
 */
export function stepComment(order: number[], current: number | null, dir: 1 | -1): number | null {
  if (!order.length) return null
  const at = current === null ? -1 : order.indexOf(current)
  if (at < 0) return dir === 1 ? order[0] : order[order.length - 1]
  return order[(at + dir + order.length) % order.length]
}

/** Comments that can be deleted: locked ones cannot. */
export const deletable = (list: Annot[]): Annot[] => list.filter((a) => !isLocked(a))

/** The distinct subjects used, sorted, for the filter list. */
export const subjectsOf = (list: Annot[]): string[] => [...new Set(list.map((a) => a.subject).filter((x): x is string => !!x))].sort((x, y) => x.localeCompare(y))
