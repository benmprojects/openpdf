/**
 * Cropping aids: finding the margins that trim the white edges off pages (from small renders of them), and planning
 * different margins for odd and even pages. Pure; the renders are made by the caller.
 */
import type { CropMargins } from './pageMarks'
import type { Frac } from './contentBox'

/** The least left of a page side, in points, after cropping. */
const MIN_SIDE = 20

export interface PageDims {
  width: number
  height: number
}

/**
 * Margins (points, as the page is displayed) that leave the content box with `pad` points around it. A box of null
 * (a blank page) gives null. Never leaves less than 20 points of either side.
 */
export function marginsForBox(box: Frac | null, size: PageDims, pad: number): CropMargins | null {
  if (!box) return null
  const left = Math.max(0, box.x0 * size.width - pad)
  const right = Math.max(0, (1 - box.x1) * size.width - pad)
  const top = Math.max(0, box.y0 * size.height - pad)
  const bottom = Math.max(0, (1 - box.y1) * size.height - pad)
  const fit = (a: number, b: number, total: number): [number, number] => {
    const room = total - MIN_SIDE
    return a + b > room ? [(a * room) / (a + b), (b * room) / (a + b)] : [a, b]
  }
  const [l, r] = fit(left, right, size.width)
  const [t, bt] = fit(top, bottom, size.height)
  return { left: l, right: r, top: t, bottom: bt }
}

export interface CropItem {
  page: number
  margins: CropMargins
}

/**
 * One crop per page. With `same`, every page gets the margins of the page whose content reaches furthest out on each
 * side (so nothing is cut off any page and the pages stay one size); otherwise each page is trimmed to its own content.
 * Blank pages are left alone unless `same`, when they take the common margins.
 */
export function trimPlan(pages: number[], boxes: (Frac | null)[], sizes: PageDims[], pad: number, same: boolean): CropItem[] {
  const own = pages.map((p, i) => ({ page: p, margins: marginsForBox(boxes[i], sizes[p], pad) }))
  if (!same) return own.flatMap((o) => (o.margins ? [{ page: o.page, margins: o.margins }] : []))
  const have = own.filter((o): o is { page: number; margins: CropMargins } => o.margins !== null)
  if (!have.length) return []
  // Pages of different sizes are compared as shares of their size, then turned back into points for each page.
  const share = have.map((o) => ({
    l: o.margins.left / sizes[o.page].width,
    r: o.margins.right / sizes[o.page].width,
    t: o.margins.top / sizes[o.page].height,
    b: o.margins.bottom / sizes[o.page].height
  }))
  const m = {
    l: Math.min(...share.map((x) => x.l)),
    r: Math.min(...share.map((x) => x.r)),
    t: Math.min(...share.map((x) => x.t)),
    b: Math.min(...share.map((x) => x.b))
  }
  return pages.map((p) => ({ page: p, margins: { left: m.l * sizes[p].width, right: m.r * sizes[p].width, top: m.t * sizes[p].height, bottom: m.b * sizes[p].height } }))
}

/** Margins for odd and even page numbers (page 1 is odd) when they differ, as one crop per page. */
export function oddEvenPlan(pages: number[], odd: CropMargins, even: CropMargins): CropItem[] {
  return pages.map((p) => ({ page: p, margins: p % 2 === 0 ? odd : even }))
}
