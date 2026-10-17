/**
 * Making links in bulk from page text: one for each web address found, or one for each place some text appears. Pure:
 * the page text comes in, the boxes to put links over come out. Places that already have a link are skipped.
 */
import { findUrls, type LinkAction } from './linkLogic'
import type { PageText } from './pdfiumRaw'
import { findPattern, type SearchOpts } from './searchPatterns'
import { rangeRects, type Rect } from './textLogic'

export interface LinkTarget {
  linkUri?: string
  linkPage?: number
  linkAction?: LinkAction
}

export interface NewLink {
  page: number
  rect: Rect
  target: LinkTarget
}

/** Boxes that already carry a link on a page. */
export interface ExistingLink {
  page: number
  rects: Rect[]
}

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Whether a box is mostly under a link already (a third of its area is enough). */
export function alreadyLinked(rect: Rect, page: number, existing: ExistingLink[]): boolean {
  const area = rect.w * rect.h
  return area > 0 && existing.some((e) => e.page === page && e.rects.some((r) => overlap(rect, r) >= area / 3))
}

/** Boxes (one per line of text) for a character range, thinned so that tiny slivers do not become links. */
function boxesFor(pt: PageText, from: number, to: number): Rect[] {
  return rangeRects(pt.boxes, from, to).filter((r) => r.w >= 2 && r.h >= 2)
}

/** A link over every web address in a page's text. */
export function urlLinksForPage(page: number, pt: PageText, existing: ExistingLink[]): NewLink[] {
  const out: NewLink[] = []
  for (const f of findUrls(pt.text)) {
    for (const rect of boxesFor(pt, pt.charOf[f.from], pt.charOf[f.end - 1])) {
      if (!alreadyLinked(rect, page, existing)) out.push({ page, rect, target: { linkUri: f.url } })
    }
  }
  return out
}

/** A link over every place `query` appears on a page, all to the same target. */
export function matchLinksForPage(page: number, pt: PageText, query: string, opts: SearchOpts, target: LinkTarget, existing: ExistingLink[]): NewLink[] {
  const out: NewLink[] = []
  for (const m of findPattern(pt, page, query, opts)) {
    for (const rect of boxesFor(pt, m.from, m.to)) {
      if (!alreadyLinked(rect, page, existing)) out.push({ page, rect, target })
    }
  }
  return out
}
