import { reviewState, type Annot, type Reply } from './annotations'
import type { Rect } from './textLogic'

export interface Changed {
  mine: Annot
  theirs: Annot
  /** What differs, in words: "text", "colour", "status", "replies". */
  diffs: string[]
}

export interface Comparison {
  changed: Changed[]
  onlyMine: Annot[]
  onlyTheirs: Annot[]
  same: number
}

function bounds(a: Annot): Rect {
  const xs = a.rects.flatMap((r) => [r.x, r.x + r.w])
  const ys = a.rects.flatMap((r) => [r.y, r.y + r.h])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Overlap of two boxes as intersection over union (0 to 1); tiny boxes (icons) also match by nearness. */
function overlap(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const inter = ix * iy
  const union = a.w * a.h + b.w * b.h - inter
  const iou = union > 0 ? inter / union : 0
  const near = Math.hypot(a.x - b.x, a.y - b.y) < 3 && Math.abs(a.w - b.w) < 3 && Math.abs(a.h - b.h) < 3 ? 1 : 0
  return Math.max(iou, near)
}

const replyKey = (r: Reply) => `${r.author}\u0000${r.text}\u0000${r.state ?? ''}`

/**
 * Pairs the comments of two copies of a document (same page, same kind, mostly the same place) and reports what
 * changed, and what is only in one copy.
 */
export function compareAnnots(mine: Annot[], theirs: Annot[]): Comparison {
  const free = new Set(theirs.map((_, i) => i))
  const changed: Changed[] = []
  const onlyMine: Annot[] = []
  let same = 0
  for (const a of mine) {
    const ab = bounds(a)
    let best = -1
    let bestScore = 0.6
    for (const i of free) {
      const b = theirs[i]
      if (b.page !== a.page || b.kind !== a.kind) continue
      const score = overlap(ab, bounds(b))
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    if (best < 0) {
      onlyMine.push(a)
      continue
    }
    free.delete(best)
    const b = theirs[best]
    const diffs: string[] = []
    if ((a.text ?? '') !== (b.text ?? '')) diffs.push('text')
    if (a.color.toLowerCase() !== b.color.toLowerCase() || (a.fill ?? '') !== (b.fill ?? '')) diffs.push('colour')
    if (reviewState(a) !== reviewState(b)) diffs.push('status')
    const mineReplies = new Set((a.replies ?? []).map(replyKey))
    if ((b.replies ?? []).some((r) => !mineReplies.has(replyKey(r)))) diffs.push('replies')
    if (diffs.length) changed.push({ mine: a, theirs: b, diffs })
    else same++
  }
  return { changed, onlyMine, onlyTheirs: [...free].sort((x, y) => x - y).map((i) => theirs[i]), same }
}

/** Mine, updated with their text, colours and status, plus any of their replies mine lacks. */
export function takeTheirs(mine: Annot, theirs: Annot, nextId: () => number): Annot {
  const have = new Set((mine.replies ?? []).map(replyKey))
  const extra = (theirs.replies ?? []).filter((r) => !have.has(replyKey(r))).map((r) => ({ ...r, id: nextId(), origin: undefined }))
  return { ...mine, text: theirs.text, color: theirs.color, fill: theirs.fill, replies: [...(mine.replies ?? []), ...extra] }
}
