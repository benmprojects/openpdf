import type { Rect } from './textLogic'

export type AnnotKind =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'squiggly'
  /** Insert-text mark: a caret where text should go, with the text to insert as its comment. */
  | 'caret'
  | 'note'
  | 'textbox'
  /** Free text typed straight onto the page: no box, grows with the text. */
  | 'typewriter'
  /** A boxed comment with a leader line and arrow pointing at something (points[0][0] is the arrow tip). */
  | 'callout'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'ink'
  | 'polygon'
  | 'polyline'
  /** A polygon with a scalloped ("cloudy") border, for marking up areas on drawings. */
  | 'cloud'
  | 'stamp'
  /**
   * An annotation from the file that we do not draw ourselves (another tool's stamp, a file attachment and so on):
   * it keeps its own appearance and can be moved, resized, deleted and commented on.
   */
  | 'foreign'
  /** A link: a box on the page that goes to a page (`linkPage`) or opens a web address (`linkUri`). */
  | 'link'

export interface Pt {
  x: number
  y: number
}

/** Review states a reviewer can give a comment (ISO 32000 12.5.6.3, state model "Review"). */
export type ReviewState = 'None' | 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed'
export type FontFamily = 'Helvetica' | 'Times' | 'Courier'
export const FONT_FAMILIES: FontFamily[] = ['Helvetica', 'Times', 'Courier']
/** CSS font stack that looks like each PDF standard font on screen. */
export const FONT_CSS: Record<FontFamily, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Times: "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace"
}
/** Kinds whose text font can be chosen. */
export const hasFont = (k: AnnotKind) => k === 'textbox' || k === 'typewriter' || k === 'callout'

/** Style a tool applies to what it creates; also what a saved preset holds. */
export interface ToolStyle {
  color?: string
  fill?: string
  dash?: 'dashed' | 'dotted'
  lineWidth?: number
  opacity?: number
  fontFamily?: FontFamily
  fontSize?: number
}

export const REVIEW_STATES: ReviewState[] = ['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed']

/** A reply in a comment's thread, or a change of its review state when `state` is set. */
export interface Reply {
  id: number
  author: string
  text: string
  /** ISO date-time. */
  date: string
  state?: ReviewState
  /** Set when the reply was already in the file: where to find it again (it is a Text annotation). */
  origin?: { index: number; subtype: number; rect: [number, number, number, number] }
}

/**
 * An annotation that has been drawn but not yet written to the PDF. Geometry is in points from the top-left
 * of the displayed page (after page rotation), the same space as the character boxes from the worker.
 */
export interface Annot {
  id: number
  /** Zero-based page index. */
  page: number
  kind: AnnotKind
  /** `#rrggbb` */
  color: string
  /** Text markup: one rectangle per line of text. Note and text box: exactly one. */
  rects: Rect[]
  /** Contents of a note or text box; the label of a stamp. */
  text: string
  fontSize: number
  /** Stroke width in points, for lines, arrows, shapes, ink and stamp borders. */
  lineWidth: number
  /** Line and arrow: one path of two points. Ink: one path of many points. */
  points?: Pt[][]
  /** Strikeout only: the struck text is to be replaced by `text` (saved as a caret grouped with the strikeout). */
  replace?: boolean
  /** Interior colour of rectangles, ellipses, polygons and clouds; none when unset. */
  fill?: string
  /** Line style of shapes; solid when unset. */
  dash?: 'dashed' | 'dotted'
  /** 0.1 to 1; fully opaque when unset. */
  opacity?: number
  /** Text box, typewriter and callout font. Helvetica when unset. */
  fontFamily?: FontFamily
  /** Link target: a web or mail address. */
  linkUri?: string
  /** Link target: a zero-based page. */
  linkPage?: number
  /** Who made it (/T). */
  author?: string
  /** ISO date-times of creation and last change. */
  created?: string
  modified?: string
  /** The thread of replies and review-state changes, oldest first. */
  replies?: Reply[]
  /** Image stamp: the picture as a data: URL (PNG or JPEG). */
  image?: string
  /** Text stamp: a second, smaller line, such as who stamped it and when. */
  stampInfo?: string
  /**
   * Set on measurements: a line (distance), polyline (perimeter) or polygon (area) with the scale used.
   * `factor` is real units per point; `label` is the result as shown, for example "12.5 m".
   */
  measure?: { kind: 'distance' | 'perimeter' | 'area'; factor: number; unit: string; ratio?: string; label: string }
  /** Set when the annotation was already in the file: where to find it again when saving. */
  origin?: {
    /** Position in the page's /Annots array. */
    index: number
    /** FPDF_ANNOT_* subtype number. */
    subtype: number
    /** /Rect in user space: left, bottom, right, top. */
    rect: [number, number, number, number]
  }
}

/** The review state of a comment: the latest state change in its thread. */
export function reviewState(a: Annot): ReviewState {
  const s = [...(a.replies ?? [])].reverse().find((r) => r.state)
  return s?.state ?? 'None'
}

/** A PDF date string (D:YYYYMMDDHHmmSS+HH'mm') as ISO, or undefined if it cannot be read. */
export function pdfDateToIso(s: string): string | undefined {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s.trim())
  if (!m) return undefined
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m
  const zone = !tz || tz === 'Z' || tz === 'z' ? 'Z' : `${tz}${th}:${tm}`
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`)
  return isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Australian date and time for display: 15/10/2026 14:05. */
export function formatWhen(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Fields that make up an annotation's appearance, to tell whether an imported one has been edited. */
export function signature(a: Annot): string {
  return JSON.stringify([a.rects, a.color, a.text, a.fontSize, a.lineWidth, a.points, a.replace ?? false, a.fill ?? null, a.dash ?? null, a.measure ?? null, a.stampInfo ?? null, a.image ? a.image.length : null, a.opacity ?? 1, a.fontFamily ?? null, a.linkUri ?? null, a.linkPage ?? null])
}

export const NOTE_SIZE = 22
export const DEFAULT_FONT_SIZE = 12
export const TEXTBOX_DEFAULT = { w: 180, h: 54 }
export const TEXTBOX_PADDING = 2
export const TEXTBOX_LINE_HEIGHT = 1.2

/** Where the underline and strikeout sit within a text line's box, as a fraction of its height from the top. */
export const UNDERLINE_AT = 0.88
export const STRIKEOUT_AT = 0.55
/** Squiggly underline: wave length and height as fractions of the line height. */
export const SQUIGGLE_AT = 0.9
export const SQUIGGLE_PERIOD = 0.33
export const SQUIGGLE_AMPLITUDE = 0.07
export const LINE_WIDTH = 1

export const MARKUP_COLORS = ['#ffd400', '#7ee081', '#6ec1ff', '#ff8ac2', '#ff9a3c', '#e5322d']
export const TEXT_COLORS = ['#000000', '#e5322d', '#1f5fd1', '#1c8a3a']

export const SHAPE_COLORS = ['#e5322d', '#1f5fd1', '#1c8a3a', '#000000', '#ff9a3c', '#7b3fe4']
export const LINE_WIDTHS = [1, 2, 4, 6]
export const DEFAULT_LINE_WIDTH = 2
export const STAMP_LABELS = ['APPROVED', 'NOT APPROVED', 'DRAFT', 'FINAL', 'CONFIDENTIAL', 'FOR COMMENT', 'REVIEWED']

export const isPathKind = (k: AnnotKind) => k === 'line' || k === 'arrow' || k === 'ink' || isVertexKind(k)
/** Kinds drawn through a list of clicked corners. */
export const isVertexKind = (k: AnnotKind) => k === 'polygon' || k === 'polyline' || k === 'cloud'
export const isShapeKind = (k: AnnotKind) => isPathKind(k) || k === 'rectangle' || k === 'ellipse'
/** Kinds that can have an interior colour. */
export const canFill = (k: AnnotKind) => k === 'rectangle' || k === 'ellipse' || k === 'polygon' || k === 'cloud'
/** Kinds that can have a dashed or dotted line. */
export const canDash = (k: AnnotKind) => isShapeKind(k) && k !== 'ink'

/** Dash pattern for a line style at a width, in points (PDF /D and SVG stroke-dasharray). */
export function dashArray(dash: Annot['dash'], lineWidth: number): number[] | null {
  if (dash === 'dashed') return [lineWidth * 3 + 2, lineWidth * 2 + 2]
  if (dash === 'dotted') return [0.01, lineWidth * 2 + 1]
  return null
}

/** Size of one cloud scallop for a line width. */
export const cloudBump = (lineWidth: number) => Math.max(8, lineWidth * 4 + 4)

/**
 * The scalloped border of a cloud, as cubic Bézier segments from `start`: each edge is split into bumps that bulge
 * outwards, each a half circle (approximated with control points 4/3 of the radius out).
 */
export function cloudCurves(pts: Pt[], lineWidth: number): { start: Pt; curves: [Pt, Pt, Pt][] } {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    area += a.x * b.y - b.x * a.y
  }
  const out = area >= 0 ? 1 : -1
  const curves: [Pt, Pt, Pt][] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 0.01) continue
    const k = Math.max(1, Math.round(len / cloudBump(lineWidth)))
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    const nx = uy * out
    const ny = -ux * out
    const step = len / k
    const h = (4 / 3) * (step / 2)
    for (let j = 0; j < k; j++) {
      const p0 = { x: a.x + ux * step * j, y: a.y + uy * step * j }
      const p1 = { x: a.x + ux * step * (j + 1), y: a.y + uy * step * (j + 1) }
      curves.push([{ x: p0.x + nx * h, y: p0.y + ny * h }, { x: p1.x + nx * h, y: p1.y + ny * h }, p1])
    }
  }
  return { start: pts[0], curves }
}
/** Kinds whose size can be changed with the corner handle. */
export const isResizable = (k: AnnotKind) => k === 'textbox' || k === 'rectangle' || k === 'ellipse' || k === 'stamp' || k === 'foreign'

export function arrowHeadLength(lineWidth: number): number {
  return Math.max(9, lineWidth * 4.5)
}

/** Default size of a stamp for its label: the text sets the width; a second line makes it taller. */
export function stampSize(label: string, info?: string): { w: number; h: number } {
  const w = Math.round(28 + label.length * 13)
  return info ? { w: Math.max(w, Math.round(20 + info.length * 5.6)), h: 46 } : { w, h: 36 }
}

/** Default size of an image stamp: 150 pt along its longer side, keeping its shape. */
export function imageStampSize(width: number, height: number): { w: number; h: number } {
  const s = 150 / Math.max(1, width, height)
  return { w: Math.max(8, Math.round(width * s)), h: Math.max(8, Math.round(height * s)) }
}

/** "Name, 15/10/2026 14:05": the second line of a dated stamp, in Australian date order. */
export function stampInfoLine(author: string, when = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${p(when.getDate())}/${p(when.getMonth() + 1)}/${when.getFullYear()} ${p(when.getHours())}:${p(when.getMinutes())}`
  return author ? `${author}, ${date}` : date
}

/** The three points of an open arrow head at `to`, as [left barb, tip, right barb]. */
export function arrowHeadPoints(from: Pt, to: Pt, lineWidth: number): [Pt, Pt, Pt] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const hl = Math.min(arrowHeadLength(lineWidth), len * 0.6)
  const a = Math.PI / 7
  const barb = (s: number): Pt => ({
    x: to.x - hl * (ux * Math.cos(s) - uy * Math.sin(s)),
    y: to.y - hl * (ux * Math.sin(s) + uy * Math.cos(s))
  })
  return [barb(a), to, barb(-a)]
}

/** Douglas-Peucker: drops points that lie within `epsilon` of the line between their neighbours. */
export function simplifyPath(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    const a = points[lo]
    const b = points[hi]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    let far = -1
    let farDist = epsilon
    for (let i = lo + 1; i < hi; i++) {
      const d = Math.abs((b.x - a.x) * (a.y - points[i].y) - (a.x - points[i].x) * (b.y - a.y)) / len
      if (d > farDist) {
        far = i
        farDist = d
      }
    }
    if (far >= 0) {
      keep[far] = true
      stack.push([lo, far], [far, hi])
    }
  }
  return points.filter((_, i) => keep[i])
}

export function pointsBounds(paths: Pt[][], pad: number): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const path of paths)
    for (const p of path) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }
}

/** Line, arrow and ink keep their geometry in `points`; `rects[0]` is the box around them. */
export function pathBounds(kind: AnnotKind, lineWidth: number, points: Pt[][]): Rect {
  const pad =
    kind === 'arrow'
      ? Math.max(lineWidth / 2, arrowHeadLength(lineWidth) * 0.6)
      : kind === 'cloud'
        ? lineWidth / 2 + cloudBump(lineWidth) * 0.7
        : lineWidth / 2
  return pointsBounds(points, pad)
}

export function withBounds(a: Annot): Annot {
  if (!a.points || !isPathKind(a.kind)) return a
  return { ...a, rects: [pathBounds(a.kind, a.lineWidth, a.points)] }
}

export function translated(a: Annot, dx: number, dy: number): Annot {
  return {
    ...a,
    rects: a.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
    points: a.points?.map((path) => path.map((p) => ({ x: p.x + dx, y: p.y + dy })))
  }
}

export function defaultColor(kind: AnnotKind): string {
  switch (kind) {
    case 'line':
    case 'arrow':
    case 'rectangle':
    case 'ellipse':
    case 'ink':
    case 'polygon':
    case 'polyline':
    case 'cloud':
    case 'stamp':
    case 'foreign':
      return '#e5322d'
    case 'link':
      return '#1f5fd1'
    case 'highlight':
    case 'note':
      return '#ffd400'
    case 'underline':
    case 'strikeout':
      return '#e5322d'
    case 'squiggly':
      return '#1c8a3a'
    case 'caret':
      return '#1f5fd1'
    case 'textbox':
    case 'typewriter':
      return '#000000'
    case 'callout':
      return '#e5322d'
  }
}

export function colorChoices(kind: AnnotKind): string[] {
  if (kind === 'textbox' || kind === 'typewriter') return TEXT_COLORS
  return isShapeKind(kind) || kind === 'stamp' || kind === 'caret' || kind === 'callout' ? SHAPE_COLORS : MARKUP_COLORS
}

/** `#rrggbb` to [r, g, b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function annotLabel(kind: AnnotKind): string {
  return {
    highlight: 'Highlight',
    underline: 'Underline',
    strikeout: 'Strikeout',
    squiggly: 'Squiggly',
    caret: 'Insert text',
    note: 'Note',
    textbox: 'Text box',
    typewriter: 'Typewriter',
    callout: 'Callout',
    line: 'Line',
    arrow: 'Arrow',
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    ink: 'Pencil',
    polygon: 'Polygon',
    polyline: 'Polyline',
    cloud: 'Cloud',
    stamp: 'Stamp',
    foreign: 'Annotation',
    link: 'Link'
  }[kind]
}

export function isMarkup(kind: AnnotKind): boolean {
  return kind === 'highlight' || kind === 'underline' || kind === 'strikeout' || kind === 'squiggly'
}

/** The squiggly line under one text line's box, as SVG/PDF path points (a zigzag of short segments). */
export function squigglePoints(r: Rect): Pt[] {
  const y = r.y + r.h * SQUIGGLE_AT
  const period = Math.max(2, r.h * SQUIGGLE_PERIOD)
  const amp = Math.max(0.6, r.h * SQUIGGLE_AMPLITUDE)
  const pts: Pt[] = []
  for (let x = r.x, i = 0; x <= r.x + r.w + 0.01; x += period / 2, i++) pts.push({ x: Math.min(x, r.x + r.w), y: y + (i % 2 ? amp : -amp) })
  return pts
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Rubs out the parts of ink paths within `radius` of the eraser's trail. A path is split where points are
 * removed; pieces of fewer than two points are dropped. Returns null when nothing was touched.
 */
export function eraseFromPaths(paths: Pt[][], trail: Pt[], radius: number): Pt[][] | null {
  const hit = (p: Pt) => trail.some((t, i) => (i ? distToSegment(p, trail[i - 1], t) : Math.hypot(p.x - t.x, p.y - t.y)) <= radius)
  let changed = false
  const out: Pt[][] = []
  for (const path of paths) {
    let cur: Pt[] = []
    for (const p of path) {
      if (hit(p)) {
        changed = true
        if (cur.length >= 2) out.push(cur)
        cur = []
      } else cur.push(p)
    }
    if (cur.length >= 2) out.push(cur)
    else if (cur.length) changed = changed || cur.length !== path.length
  }
  return changed ? out : null
}

/** The point on a callout box's edge nearest the arrow tip, where the leader line meets the box. */
export function calloutAttach(box: Rect, tip: Pt): Pt {
  const x = Math.max(box.x, Math.min(box.x + box.w, tip.x))
  const y = Math.max(box.y, Math.min(box.y + box.h, tip.y))
  if (x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h) {
    // Tip inside the box: go to the nearest side.
    const d = [y - box.y, box.y + box.h - y, x - box.x, box.x + box.w - x]
    const i = d.indexOf(Math.min(...d))
    return i === 0 ? { x, y: box.y } : i === 1 ? { x, y: box.y + box.h } : i === 2 ? { x: box.x, y } : { x: box.x + box.w, y }
  }
  return { x, y }
}

export const CALLOUT_DEFAULT = { w: 160, h: 40 }

let measureCtx: CanvasRenderingContext2D | null | undefined
/** Width of Helvetica text at a size; uses a canvas when there is one, otherwise an estimate (tests). */
export function textWidth(text: string, size: number): number {
  if (typeof document !== 'undefined') {
    measureCtx ??= document.createElement('canvas').getContext('2d')
    if (measureCtx) {
      measureCtx.font = `${size}px Helvetica, Arial, sans-serif`
      return measureCtx.measureText(text).width
    }
  }
  return text.length * size * 0.55
}

/** The box a typewriter annotation needs for its text, from its top-left corner. */
export function typewriterRect(x: number, y: number, text: string, size: number): Rect {
  const lines = (text || ' ').split(/\r\n|\r|\n/)
  const w = Math.max(...lines.map((l) => textWidth(l, size))) + 2 * TEXTBOX_PADDING + 2
  return { x, y, w: Math.max(12, w), h: lines.length * size * TEXTBOX_LINE_HEIGHT + 2 * TEXTBOX_PADDING }
}

/** Where a replace or insert caret sits for a text line: just past its end, in the lower part of the line. */
export function caretRectAfter(r: Rect): Rect {
  const h = Math.max(6, r.h * 0.6)
  return { x: r.x + r.w - h * 0.4, y: r.y + r.h - h * 0.9, w: h * 0.8, h }
}

export function pointInRect(r: Rect, x: number, y: number, slop = 0): boolean {
  return x >= r.x - slop && x <= r.x + r.w + slop && y >= r.y - slop && y <= r.y + r.h + slop
}
