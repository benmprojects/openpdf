/**
 * Comment styles: the look of a comment as a ToolStyle (what a tool preset or default holds), taking the look of a
 * selected comment, and giving a saved style to existing comments.
 */
import {
  canBlend,
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
    ...(canBlend(a.kind) && a.blend ? { blend: a.blend } : {})
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
  if (a.kind === 'typewriter' && (s.fontSize || s.fontFamily)) next.rects = [typewriterRect(a.rects[0].x, a.rects[0].y, a.text, next.fontSize)]
  return withBounds(next)
}

/** A style with its empty entries dropped, as saved in settings. */
export function cleanStyle(s: ToolStyle): ToolStyle {
  const out: ToolStyle = {}
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
  return out
}
