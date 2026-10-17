/**
 * Comment styles: the look of a comment as a ToolStyle (what a tool preset or default holds), taking the look of a
 * selected comment, and giving a saved style to existing comments.
 */
import { isLineEnd } from './lineEnds'
import {
  BLEND_MODES,
  FONT_FAMILIES,
  canBlend,
  canIcon,
  isNoteIcon,
  canCloud,
  canDash,
  canFill,
  canLineEnds,
  hasFont,
  isShapeKind,
  typewriterRect,
  withBounds,
  type Annot,
  type ToolStyle
} from './annotations'

/** The look of an annotation as a style; only what its kind can have. */
export function styleOf(a: Annot): ToolStyle & { color: string } {
  return {
    color: a.color,
    ...(canFill(a.kind) && a.fill ? { fill: a.fill } : {}),
    ...(canDash(a.kind) && a.dash ? { dash: a.dash } : {}),
    ...(isShapeKind(a.kind) || a.kind === 'stamp' ? { lineWidth: a.lineWidth } : {}),
    ...(a.opacity !== undefined ? { opacity: a.opacity } : {}),
    ...(hasFont(a.kind) ? { fontFamily: a.fontFamily, fontSize: a.fontSize } : {}),
    ...(canLineEnds(a.kind) && a.lineStart ? { lineStart: a.lineStart } : {}),
    ...(canLineEnds(a.kind) && a.lineEnd ? { lineEnd: a.lineEnd } : {}),
    ...(canCloud(a.kind) && a.cloud !== undefined ? { cloud: a.cloud } : {}),
    ...(canBlend(a.kind) && a.blend ? { blend: a.blend } : {}),
    ...(canIcon(a.kind) && a.icon ? { icon: a.icon } : {})
  }
}

/**
 * The annotation with a style applied. A style only sets what the annotation's kind can have, so a style saved from
 * a cloud can be given to a rectangle (colour, line width, scallops) without giving it line ends. Properties the
 * style leaves out are cleared when `replace` is set (a saved style is a complete look), otherwise kept.
 */
export function applyStyle(a: Annot, s: ToolStyle, replace = true): Annot {
  const next: Annot = { ...a }
  if (s.color) next.color = s.color
  if (canFill(a.kind) && (replace || 'fill' in s)) next.fill = s.fill
  if (canDash(a.kind) && (replace || 'dash' in s)) next.dash = s.dash
  if ((isShapeKind(a.kind) || a.kind === 'stamp') && s.lineWidth !== undefined) next.lineWidth = s.lineWidth
  if (replace || 'opacity' in s) next.opacity = s.opacity !== undefined && s.opacity < 1 ? s.opacity : undefined
  if (hasFont(a.kind)) {
    if (s.fontFamily !== undefined || replace) next.fontFamily = s.fontFamily
    if (s.fontSize) next.fontSize = s.fontSize
  }
  if (canLineEnds(a.kind) && (replace || 'lineStart' in s || 'lineEnd' in s)) {
    next.lineStart = s.lineStart
    next.lineEnd = s.lineEnd
  }
  if (canCloud(a.kind) && (replace || 'cloud' in s)) next.cloud = s.cloud
  if (canBlend(a.kind) && (replace || 'blend' in s)) next.blend = s.blend
  if (canIcon(a.kind) && (replace || 'icon' in s)) next.icon = s.icon
  if (a.kind === 'typewriter' && (s.fontSize || s.fontFamily)) next.rects = [typewriterRect(a.rects[0].x, a.rects[0].y, a.text, next.fontSize)]
  return withBounds(next)
}

/** A style with its empty entries dropped, as saved in settings. */
export function cleanStyle(s: ToolStyle): ToolStyle {
  const out: ToolStyle = {}
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
  return out
}

// ---- Style sets: saved styles as a file, to share between people and computers ------------------------

/** A saved style, as kept in settings. */
export interface StylePreset {
  id: string
  name: string
  kind: string
  style: ToolStyle
}

/** Marks the file as ours and says which layout it has. */
export const STYLE_SET_FORMAT = 'openpdf-comment-styles'

/** The saved styles as the text of a style set file (JSON). */
export function exportStyleSet(presets: StylePreset[]): string {
  return JSON.stringify({ format: STYLE_SET_FORMAT, version: 1, styles: presets.map((p) => ({ id: p.id, name: p.name, kind: p.kind, style: cleanStyle(p.style) })) }, null, 2)
}

const HEX = /^#[0-9a-fA-F]{6}$/
const KINDS = new Set(['highlight', 'underline', 'strikeout', 'squiggly', 'caret', 'note', 'textbox', 'typewriter', 'callout', 'line', 'arrow', 'rectangle', 'ellipse', 'ink', 'polygon', 'polyline', 'cloud', 'stamp'])
const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** Keeps only the settings of a style that are valid; anything else in a file from outside is dropped. */
export function sanitiseStyle(raw: unknown): ToolStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: ToolStyle = {}
  if (typeof r.color === 'string' && HEX.test(r.color)) out.color = r.color.toLowerCase()
  if (typeof r.fill === 'string' && HEX.test(r.fill)) out.fill = r.fill.toLowerCase()
  if (r.dash === 'dashed' || r.dash === 'dotted') out.dash = r.dash
  if (finite(r.lineWidth, 0, 72)) out.lineWidth = r.lineWidth
  if (finite(r.opacity, 0.1, 1)) out.opacity = r.opacity
  if (typeof r.fontFamily === 'string' && (FONT_FAMILIES as string[]).includes(r.fontFamily)) out.fontFamily = r.fontFamily as ToolStyle['fontFamily']
  if (finite(r.fontSize, 4, 200)) out.fontSize = r.fontSize
  if (typeof r.lineStart === 'string' && isLineEnd(r.lineStart)) out.lineStart = r.lineStart
  if (typeof r.lineEnd === 'string' && isLineEnd(r.lineEnd)) out.lineEnd = r.lineEnd
  if (r.cloud === 0 || r.cloud === 1 || r.cloud === 2) out.cloud = r.cloud
  if (typeof r.blend === 'string' && (BLEND_MODES as string[]).includes(r.blend)) out.blend = r.blend as ToolStyle['blend']
  if (isNoteIcon(r.icon)) out.icon = r.icon
  return out
}

/**
 * Reads a style set file. Throws a plain message when it is not one. Every style gets a fresh id from `newId`, so
 * importing never replaces a style by accident.
 */
export function parseStyleSet(text: string, newId: () => string): StylePreset[] {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('This is not a style set file.')
  }
  const list = Array.isArray(data) ? data : (data as { styles?: unknown } | null)?.styles
  if (!Array.isArray(list)) throw new Error('This is not a style set file.')
  const out: StylePreset[] = []
  for (const item of list) {
    const r = item as { name?: unknown; kind?: unknown; style?: unknown } | null
    if (!r || typeof r.name !== 'string' || !r.name.trim() || typeof r.kind !== 'string' || !KINDS.has(r.kind)) continue
    out.push({ id: newId(), name: r.name.trim().slice(0, 80), kind: r.kind, style: sanitiseStyle(r.style) })
  }
  if (!out.length) throw new Error('The file has no styles in it.')
  return out
}

/** `incoming` added to `existing`; a style with the same name and tool replaces the old one (keeping its place). */
export function mergeStyleSets(existing: StylePreset[], incoming: StylePreset[]): StylePreset[] {
  const out = [...existing]
  for (const p of incoming) {
    const at = out.findIndex((x) => x.name === p.name && x.kind === p.kind)
    if (at >= 0) out[at] = { ...p, id: out[at].id }
    else out.push(p)
  }
  return out
}
