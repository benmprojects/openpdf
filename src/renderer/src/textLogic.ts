import type { PageText } from './pdfiumRaw'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface CharPos {
  page: number
  char: number
}

export interface Match {
  page: number
  /** First and last character index (inclusive) on the page. */
  from: number
  to: number
}

export function comparePos(a: CharPos, b: CharPos): number {
  return a.page - b.page || a.char - b.char
}

function hasBox(boxes: Float32Array, i: number): boolean {
  return boxes[i * 4 + 2] - boxes[i * 4] > 0 && boxes[i * 4 + 3] - boxes[i * 4 + 1] > 0
}

/** Index of the character nearest to (x, y), in points from the page's top-left. -1 if the page has no text. */
export function hitTest(boxes: Float32Array, x: number, y: number): number {
  const n = boxes.length / 4
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < n; i++) {
    if (!hasBox(boxes, i)) continue
    const l = boxes[i * 4]
    const t = boxes[i * 4 + 1]
    const r = boxes[i * 4 + 2]
    const b = boxes[i * 4 + 3]
    const dx = x < l ? l - x : x > r ? x - r : 0
    const dy = y < t ? t - y : y > b ? y - b : 0
    // Weigh vertical distance more so the pointer sticks to its own line rather than a neighbour.
    const d = dx * dx + dy * dy * 4
    if (d < bestDist) {
      bestDist = d
      best = i
      if (d === 0) break
    }
  }
  return best
}

/** Merge the character boxes in [from, to] into one rectangle per text line. */
export function rangeRects(boxes: Float32Array, from: number, to: number): Rect[] {
  const n = boxes.length / 4
  const out: Rect[] = []
  let cur: { l: number; t: number; r: number; b: number } | null = null
  const flush = () => {
    if (cur) out.push({ x: cur.l, y: cur.t, w: cur.r - cur.l, h: cur.b - cur.t })
    cur = null
  }
  for (let i = Math.max(0, from); i <= Math.min(to, n - 1); i++) {
    if (!hasBox(boxes, i)) continue
    const l = boxes[i * 4]
    const t = boxes[i * 4 + 1]
    const r = boxes[i * 4 + 2]
    const b = boxes[i * 4 + 3]
    if (cur) {
      const overlap = Math.min(b, cur.b) - Math.max(t, cur.t)
      const sameLine = overlap > 0.5 * Math.min(b - t, cur.b - cur.t)
      const near = l - cur.r < (b - t) * 1.5 && l >= cur.l - (b - t)
      if (sameLine && near) {
        cur.r = Math.max(cur.r, r)
        cur.t = Math.min(cur.t, t)
        cur.b = Math.max(cur.b, b)
        continue
      }
      flush()
    }
    cur = { l, t, r, b }
  }
  flush()
  return out
}

/** Text of characters [from, to] of a page. */
export function sliceText(pt: PageText, from: number, to: number): string {
  let start = 0
  while (start < pt.charOf.length && pt.charOf[start] < from) start++
  let end = start
  while (end < pt.charOf.length && pt.charOf[end] <= to) end++
  return pt.text.slice(start, end)
}

export function normaliseNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n')
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c)

export function findInPage(pt: PageText, page: number, query: string, matchCase: boolean, wholeWord: boolean): Match[] {
  if (!query) return []
  let hay = pt.text
  let needle = query
  if (!matchCase) {
    const lowered = hay.toLowerCase()
    // toLowerCase can change string length for a few scripts; fall back to exact matching to keep offsets valid.
    if (lowered.length === hay.length) {
      hay = lowered
      needle = query.toLowerCase()
    }
  }
  const out: Match[] = []
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + Math.max(1, needle.length))) {
    const end = at + needle.length
    if (wholeWord && (isWordChar(hay[at - 1]) || isWordChar(hay[end]))) continue
    out.push({ page, from: pt.charOf[at], to: pt.charOf[end - 1] })
  }
  return out
}
