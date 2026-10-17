/** The text-correction tool: the selected text struck out for deletion, with the text to put in its place and one reply thread. */
import type { Annot, Reply } from './annotations'
import type { Rect } from './textLogic'

export interface CorrectionPart {
  page: number
  rects: Rect[]
}

export interface CorrectionOptions {
  /** Text that replaces the struck-out text; empty marks it for deletion only. */
  replacement: string
  /** A first comment in the thread, for why it should change; empty for none. */
  comment: string
  author: string
  /** ISO date-time. */
  now: string
  /** Makes a strikeout for a run of text lines (the caller gives it the current colour, author and id). */
  make: (page: number, rects: Rect[]) => Annot
  newId: () => number
}

/**
 * The marks for one correction: a strikeout over each part of the selection. The last part carries the replacement
 * (saved as a caret grouped with that strikeout) and the comment, so there is one thread however many lines or pages
 * the selection runs over. Returns nothing when there is nothing selected.
 */
export function buildCorrection(parts: CorrectionPart[], o: CorrectionOptions): Annot[] {
  const useful = parts.filter((p) => p.rects.length)
  if (!useful.length) return []
  const replacement = o.replacement.trim()
  const comment = o.comment.trim()
  return useful.map((p, i) => {
    const a: Annot = { ...o.make(p.page, p.rects), kind: 'strikeout' }
    if (i !== useful.length - 1) return a
    const reply: Reply | null = comment ? { id: o.newId(), author: o.author, text: comment, date: o.now } : null
    return { ...a, ...(replacement ? { replace: true, text: replacement } : {}), ...(reply ? { replies: [reply] } : {}) }
  })
}
