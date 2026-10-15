/**
 * Groups a page's text objects into lines and paragraph blocks, so that editing a paragraph can reflow it. Works in
 * page space from each object's matrix; only upright text on an unrotated page is grouped (anything else stays a
 * block of one run, edited as before).
 */
import type { TextObject } from './pdfiumRaw'
import type { Rect } from './textLogic'

export interface TextBlock {
  /** Ordinals of the text objects in the block, in content order. */
  ordinals: number[]
  /** The block's text with lines joined by single spaces. */
  text: string
  /** Display-space box of the whole block. */
  rect: Rect
  /** Style of the first run (all runs share it in a multi-run block). */
  font: string
  flags: number
  weight: number
  italic: boolean
  size: number
  color: string
  matrix: TextObject['matrix']
  /** Where PDFium puts the start of each object, in page space, in the same order as `ordinals`. */
  origins: { x: number; y: number }[]
  /** True when the block holds several runs or lines and can be reflowed. */
  reflow: boolean
  /** Layout in page space: x of the first line, x of the others, baseline of the first line, distance between baselines (0 for one line) and the widest line. */
  layout: { firstX: number; restX: number; baselineY: number; leading: number; width: number }
}

interface Line {
  objects: TextObject[]
  text: string
  /** Page-space start x, baseline y and right edge. */
  x: number
  y: number
  right: number
}

const SAME = (a: TextObject, b: TextObject) => a.font === b.font && Math.abs(a.size - b.size) < 0.05 && a.color === b.color && a.italic === b.italic && Math.abs(a.matrix[0] - b.matrix[0]) < 1e-3

const upright = (o: TextObject) => Math.abs(o.matrix[1]) < 1e-3 && Math.abs(o.matrix[2]) < 1e-3 && o.matrix[0] > 0 && o.matrix[3] > 0 && o.mode === 0 && o.text.trim().length > 0

function asBlock(lines: Line[], reflow: boolean): TextBlock {
  const objs = lines.flatMap((l) => l.objects)
  const first = objs[0]
  const rects = objs.map((o) => o.rect)
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  const leading = lines.length > 1 ? (lines[0].y - lines[lines.length - 1].y) / (lines.length - 1) : 0
  return {
    ordinals: objs.map((o) => o.ordinal),
    origins: objs.map((o) => ({ x: o.matrix[4], y: o.matrix[5] })),
    text: lines.map((l) => l.text).join(' '),
    rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    font: first.font,
    flags: first.flags,
    weight: first.weight,
    italic: first.italic,
    size: first.size,
    color: first.color,
    matrix: first.matrix,
    reflow,
    layout: { firstX: lines[0].x, restX: lines.length > 1 ? lines[1].x : lines[0].x, baselineY: lines[0].y, leading, width: Math.max(...lines.map((l) => l.right - Math.min(lines[0].x, lines[lines.length > 1 ? 1 : 0].x))) }
  }
}

/** Most lines one paragraph block may have; more than this is a column or a table, not a paragraph. */
const MAX_LINES = 60

/**
 * Whether lines could be one wrapped paragraph: every line but the last runs nearly the full width (at least 60 % of
 * the longest line), and a two-line paragraph does not start with a line much shorter than its second. Short entries
 * stacked in a column or table fail this and stay separate.
 */
function plausibleParagraph(lines: Line[]): boolean {
  if (lines.length > MAX_LINES) return false
  const w = lines.map((l) => l.right - l.x)
  const max = Math.max(...w)
  // Every line but the last is several words wide and runs nearly the full width.
  for (let i = 0; i < w.length - 1; i++) if (w[i] < 0.6 * max || !/\s/.test(lines[i].text.trim())) return false
  if (w.length === 2 && w[0] < 0.85 * w[1]) return false
  return true
}

/** Whether line `b` reads as the continuation of line `a`: `a` does not end a sentence and `b` starts in lower case. */
const continues = (a: Line, b: Line) => !/[.:;?!]$/.test(a.text.trim()) && /^[a-z]/.test(b.text.trim())

/**
 * Splits a run of evenly spaced, left-aligned lines into paragraphs: the longest stretch that looks like wrapped text
 * from each start. A stretch of two lines is only taken when the second continues the first (otherwise two cells of a
 * table would be joined).
 */
function splitRun(run: Line[]): Line[][] {
  const out: Line[][] = []
  let i = 0
  while (i < run.length) {
    let k = 1
    while (i + k < run.length && plausibleParagraph(run.slice(i, i + k + 1))) k++
    if (k === 2 && !continues(run[i], run[i + 1])) k = 1
    out.push(run.slice(i, i + k))
    i += k
  }
  return out
}

/**
 * Blocks of editable text. A block is a run of lines in the same font, size and colour whose baselines are evenly
 * spaced (0.9 to 2.2 times the size) and which start at the same left edge (the first may be indented). Everything
 * that does not fit that, such as rotated text, mixed styles or a page that is rotated, is a block of one run.
 */
export function groupBlocks(objects: TextObject[], pageRotation: number): TextBlock[] {
  const single = (o: TextObject): TextBlock => asBlock([{ objects: [o], text: o.text, x: o.matrix[4], y: o.matrix[5], right: o.matrix[4] + o.rect.w }], false)
  if (pageRotation % 360 !== 0) return objects.filter((o) => o.text.length > 0).map(single)

  const blocks: TextBlock[] = []
  let lines: Line[] = []
  const flush = () => {
    for (const run of splitRun(lines)) blocks.push(asBlock(run, run.length > 1 || run[0].objects.length > 1))
    lines = []
  }

  for (const o of objects) {
    if (!o.text.length) continue
    if (!upright(o)) {
      flush()
      blocks.push(single(o))
      continue
    }
    const x = o.matrix[4]
    const y = o.matrix[5]
    const right = x + o.rect.w
    const cur = lines[lines.length - 1]
    const prev = cur?.objects[cur.objects.length - 1]
    // Same line: same baseline, starting at or after the end of the previous run, same style.
    // A gap wider than a few spaces means a separate cell or column, not the next word.
    if (cur && prev && SAME(prev, o) && Math.abs(y - cur.y) < o.size * 0.3 && x >= cur.right - 1 && x - cur.right <= o.size * 1.2) {
      const gap = x - cur.right
      cur.text += (gap > o.size * 0.15 && !cur.text.endsWith(' ') && !o.text.startsWith(' ') ? ' ' : '') + o.text
      cur.objects.push(o)
      cur.right = right
      continue
    }
    // Next line of the same block?
    if (cur && prev && SAME(prev, o)) {
      const step = cur.y - y
      const first = lines[0]
      const ok = step > o.size * 0.9 && step < o.size * 2.2 && (lines.length < 2 || Math.abs(step - (lines[0].y - cur.y) / (lines.length - 1)) < step * 0.25)
      const left = lines.length < 2 ? Math.abs(x - first.x) <= o.size * 3 : Math.abs(x - lines[1].x) <= 2
      // The second line fixes the block's left edge: it must not start right of the first line's indent by much.
      if (ok && left) {
        lines.push({ objects: [o], text: o.text, x, y, right })
        continue
      }
    }
    flush()
    lines = [{ objects: [o], text: o.text, x, y, right }]
  }
  flush()
  return blocks
}
