import type { Rect } from './textLogic'

export type AnnotKind = 'highlight' | 'underline' | 'strikeout' | 'note' | 'textbox'

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
  /** Contents of a note or text box. */
  text: string
  fontSize: number
}

export const NOTE_SIZE = 22
export const DEFAULT_FONT_SIZE = 12
export const TEXTBOX_DEFAULT = { w: 180, h: 54 }
export const TEXTBOX_PADDING = 2
export const TEXTBOX_LINE_HEIGHT = 1.2

/** Where the underline and strikeout sit within a text line's box, as a fraction of its height from the top. */
export const UNDERLINE_AT = 0.88
export const STRIKEOUT_AT = 0.55
export const LINE_WIDTH = 1

export const MARKUP_COLORS = ['#ffd400', '#7ee081', '#6ec1ff', '#ff8ac2', '#ff9a3c', '#e5322d']
export const TEXT_COLORS = ['#000000', '#e5322d', '#1f5fd1', '#1c8a3a']

export function defaultColor(kind: AnnotKind): string {
  switch (kind) {
    case 'highlight':
    case 'note':
      return '#ffd400'
    case 'underline':
    case 'strikeout':
      return '#e5322d'
    case 'textbox':
      return '#000000'
  }
}

export function colorChoices(kind: AnnotKind): string[] {
  return kind === 'textbox' ? TEXT_COLORS : MARKUP_COLORS
}

/** `#rrggbb` to [r, g, b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function annotLabel(kind: AnnotKind): string {
  return { highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout', note: 'Note', textbox: 'Text box' }[kind]
}

export function isMarkup(kind: AnnotKind): boolean {
  return kind === 'highlight' || kind === 'underline' || kind === 'strikeout'
}

export function pointInRect(r: Rect, x: number, y: number, slop = 0): boolean {
  return x >= r.x - slop && x <= r.x + r.w + slop && y >= r.y - slop && y <= r.y + r.h + slop
}
