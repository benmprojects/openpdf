// Visual signatures and initials: smoothing a drawn stroke, typed styles, and naming. Pure, so it is unit tested.
// These are pictures of a signature, kept in the stamp library under two categories. They are not certificate signatures.

export const CAT_SIGNATURES = 'Signatures'
export const CAT_INITIALS = 'Initials'
export const isSignatureCategory = (c: string | undefined) => c === CAT_SIGNATURES || c === CAT_INITIALS

/** The /Subj written on a placed signature picture, so that it can be found again to flatten. */
export const SIGNATURE_SUBJECT = 'Visual signature'

export interface InkPoint {
  x: number
  y: number
  /** Milliseconds, for speed. */
  t: number
  /** Pen pressure 0 to 1 when the device reports it (a mouse reports 0.5 or nothing). */
  p?: number
}

const lerp = (a: InkPoint, b: InkPoint, k: number): InkPoint => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  t: a.t + (b.t - a.t) * k,
  p: a.p === undefined || b.p === undefined ? undefined : a.p + (b.p - a.p) * k
})

/**
 * Smooths a hand-drawn stroke: points closer than `minGap` to the last kept one are dropped (mouse jitter), then
 * corners are cut `rounds` times (Chaikin), keeping the two end points where the pen went down and came up.
 */
export function smoothStroke(stroke: InkPoint[], rounds = 2, minGap = 1.2): InkPoint[] {
  const kept: InkPoint[] = []
  for (const pt of stroke) {
    const last = kept[kept.length - 1]
    if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= minGap) kept.push(pt)
  }
  const tail = stroke[stroke.length - 1]
  if (tail && kept.length > 1 && kept[kept.length - 1] !== tail) kept[kept.length - 1] = tail
  let pts = kept
  for (let r = 0; r < rounds && pts.length > 2; r++) {
    const next: InkPoint[] = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      next.push(lerp(pts[i], pts[i + 1], 0.25), lerp(pts[i], pts[i + 1], 0.75))
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  return pts
}

/**
 * Line width at each point: from pen pressure when the pen reports it, otherwise from speed (a fast stroke is thinner,
 * as with a real pen). Neighbours are averaged so the width changes gently.
 */
export function strokeWidths(pts: InkPoint[], base: number): number[] {
  if (!pts.length) return []
  const pressure = pts.some((p) => p.p !== undefined && p.p > 0 && p.p !== 0.5)
  const raw = pts.map((pt, i) => {
    if (pressure) return base * (0.4 + 1.2 * (pt.p ?? 0.5))
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    const dt = Math.max(1, next.t - prev.t)
    const v = Math.hypot(next.x - prev.x, next.y - prev.y) / dt // pixels per millisecond
    return base * Math.max(0.55, Math.min(1.4, 1.5 - v * 0.5))
  })
  return raw.map((_, i) => {
    const a = raw[Math.max(0, i - 2)]
    const b = raw[Math.max(0, i - 1)]
    const c = raw[i]
    const d = raw[Math.min(raw.length - 1, i + 1)]
    const e = raw[Math.min(raw.length - 1, i + 2)]
    return (a + b + c + d + e) / 5
  })
}

/** The box around every point of every stroke, or null when there are none. */
export function inkBounds(strokes: InkPoint[][]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes)
    for (const p of s) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Capitals of the first and last words of a name: "Ben Myers" gives "BM"; one word gives one letter. */
export function initialsOf(name: string): string {
  const words = name.split(/[\s.]+/).filter((w) => /\p{L}/u.test(w))
  if (!words.length) return ''
  const letter = (w: string) => ([...w.replace(/^[^\p{L}]+/u, '')][0] ?? '').toUpperCase()
  return words.length === 1 ? letter(words[0]) : letter(words[0]) + letter(words[words.length - 1])
}

export interface TypedFont {
  id: string
  label: string
  /** CSS font-family value. */
  family: string
}

/**
 * Script-style fonts that ship with Windows or Office. They are only used to draw the picture of the signature, which
 * is then saved as an image, so no font is bundled or embedded.
 */
export const TYPED_FONTS: TypedFont[] = [
  { id: 'segoe-script', label: 'Segoe Script', family: '"Segoe Script"' },
  { id: 'ink-free', label: 'Ink Free', family: '"Ink Free"' },
  { id: 'lucida-handwriting', label: 'Lucida Handwriting', family: '"Lucida Handwriting"' },
  { id: 'brush-script', label: 'Brush Script', family: '"Brush Script MT"' },
  { id: 'freestyle', label: 'Freestyle Script', family: '"Freestyle Script"' },
  { id: 'mistral', label: 'Mistral', family: '"Mistral"' },
  { id: 'segoe-print', label: 'Segoe Print', family: '"Segoe Print"' }
]

/** The fonts for which `width(family)` differs from the width of the fallback: a missing font draws as the fallback. */
export function installedFonts(fonts: TypedFont[], width: (family: string) => number, fallbackWidth: number): TypedFont[] {
  const found = fonts.filter((f) => Math.abs(width(f.family) - fallbackWidth) > 0.5)
  return found.length ? found : [{ id: 'cursive', label: 'Cursive', family: 'cursive' }]
}

export const INK_COLOURS = [
  { id: 'black', label: 'Black', value: '#111111' },
  { id: 'blue', label: 'Blue', value: '#0b3d91' },
  { id: 'red', label: 'Red', value: '#b3261e' }
] as const
