/** Cut, copy and paste of annotations between pages: what is kept, where the copies go. Pure. */
import { translated, type Annot } from './annotations'

/** The annotations that can be copied: anything but another tool's annotation, whose appearance we only keep as it is. */
export const copyable = (list: Annot[]): Annot[] => list.filter((a) => a.kind !== 'foreign')

export interface PasteOptions {
  /** Zero-based page that receives the copies (the first of them when the copy came from several pages). */
  page: number
  pages: { width: number; height: number }[]
  /** How far, in points, copies pasted onto the page they came from move down and right so they do not hide the original. */
  nudge: number
  newId: () => number
  author?: string
  /** ISO date-time. */
  now: string
}

/** A copy that stands on its own: no place in the file, no replies or review state, a new id. */
function fresh(a: Annot, id: number, o: PasteOptions): Annot {
  const clone = structuredClone(a)
  delete clone.origin
  delete clone.replies
  delete clone.modified
  return { ...clone, id, created: o.now, ...(o.author ? { author: o.author } : {}) }
}

/**
 * Copies of `clip` placed on the target page, keeping the distances between them. Copies that land on the page
 * they came from are moved by `nudge`; copies on another page keep their position. A copy stays inside its page.
 */
export function pasteAnnots(clip: Annot[], o: PasteOptions): Annot[] {
  const list = copyable(clip)
  if (!list.length || !o.pages.length) return []
  const first = Math.min(...list.map((a) => a.page))
  const last = o.pages.length - 1
  const place = (a: Annot) => Math.max(0, Math.min(last, o.page + (a.page - first)))
  const same = list.every((a) => place(a) === a.page)
  return list.map((a) => {
    const page = place(a)
    const size = o.pages[page]
    let moved = fresh(a, o.newId(), o)
    moved.page = page
    const nudge = same ? o.nudge : 0
    // Keep the whole copy on the page.
    const xs = moved.rects.flatMap((r) => [r.x, r.x + r.w])
    const ys = moved.rects.flatMap((r) => [r.y, r.y + r.h])
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    const dx = Math.max(-x0, Math.min(size.width - x1, nudge))
    const dy = Math.max(-y0, Math.min(size.height - y1, nudge))
    moved = translated(moved, dx, dy)
    return moved
  })
}
