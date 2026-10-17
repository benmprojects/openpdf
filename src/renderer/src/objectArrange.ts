/**
 * Aligning and spreading page objects (pictures and shapes in the content) by their boxes. Pure: boxes in display space
 * (points from the top-left of the page as shown) in, moves in display space out; `displayMoveToPage` turns a move into
 * the page-space matrix the picture and shape editors take.
 */
import { matInverse, matMul, type Matrix6 } from './content'

export interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type AlignMode = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'

export interface Move {
  dx: number
  dy: number
}

/** Moves that line the boxes' edges or centres up with the outer box of all of them. Fewer than two boxes: nothing moves. */
export function alignBoxes(boxes: Box[], mode: AlignMode): Map<string, Move> {
  const out = new Map<string, Move>()
  if (boxes.length < 2) return out
  const left = Math.min(...boxes.map((b) => b.x))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const top = Math.min(...boxes.map((b) => b.y))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  for (const b of boxes) {
    let dx = 0
    let dy = 0
    if (mode === 'left') dx = left - b.x
    else if (mode === 'right') dx = right - (b.x + b.w)
    else if (mode === 'centre') dx = (left + right) / 2 - (b.x + b.w / 2)
    else if (mode === 'top') dy = top - b.y
    else if (mode === 'bottom') dy = bottom - (b.y + b.h)
    else dy = (top + bottom) / 2 - (b.y + b.h / 2)
    if (dx || dy) out.set(b.id, { dx, dy })
  }
  return out
}

/** Moves that give three or more boxes equal gaps between them along an axis; the outermost two stay where they are. */
export function distributeBoxes(boxes: Box[], axis: 'horizontal' | 'vertical'): Map<string, Move> {
  const out = new Map<string, Move>()
  if (boxes.length < 3) return out
  const h = axis === 'horizontal'
  const sorted = [...boxes].sort((a, b) => (h ? a.x - b.x : a.y - b.y))
  const size = (b: Box) => (h ? b.w : b.h)
  const start = (b: Box) => (h ? b.x : b.y)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = start(last) + size(last) - start(first)
  const gap = (span - sorted.reduce((s, b) => s + size(b), 0)) / (sorted.length - 1)
  let at = start(first) + size(first) + gap
  for (const b of sorted.slice(1, -1)) {
    const d = at - start(b)
    if (d) out.set(b.id, h ? { dx: d, dy: 0 } : { dx: 0, dy: d })
    at += size(b) + gap
  }
  return out
}

/** A move in display space as a page-space matrix: F^-1 x translate x F, with F the display-to-page matrix. Null when F cannot be inverted. */
export function displayMoveToPage(toPage: Matrix6, m: Move): Matrix6 | null {
  const inv = matInverse(toPage)
  return inv ? matMul(matMul(inv, [1, 0, 0, 1, m.dx, m.dy]), toPage) : null
}
