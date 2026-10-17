/**
 * Finding blank pages. A page is looked at as a small picture and the share of it that is marked is measured; a page is
 * blank when that share is under a threshold. The edge of the page can be left out, so the shadow of a scanner's lid
 * or a punched hole does not count as content.
 */

export interface BlankOptions {
  /** A page is blank when less than this share of it (percent) is marked. */
  thresholdPercent: number
  /** Share of each side (percent) that is not looked at. */
  marginPercent: number
}

export const DEFAULT_BLANK_OPTIONS: BlankOptions = {
  thresholdPercent: 0.1,
  marginPercent: 3
}

/** A pixel counts as marked when any colour is darker than this (0 to 255). */
const MARK_LEVEL = 200

/** Share of the pixels inside the margin that are marked, in percent (0 to 100). */
export function inkPercent(rgba: ArrayLike<number>, width: number, height: number, marginPercent = 0): number {
  if (width <= 0 || height <= 0) return 0
  const mx = Math.min(Math.floor(width / 2) - 1, Math.floor((width * marginPercent) / 100))
  const my = Math.min(Math.floor(height / 2) - 1, Math.floor((height * marginPercent) / 100))
  const x0 = Math.max(0, mx)
  const y0 = Math.max(0, my)
  let marked = 0
  let total = 0
  for (let y = y0; y < height - y0; y++) {
    for (let x = x0; x < width - x0; x++) {
      const i = (y * width + x) * 4
      total++
      // Transparent pixels are paper.
      if (rgba[i + 3] > 32 && (rgba[i] < MARK_LEVEL || rgba[i + 1] < MARK_LEVEL || rgba[i + 2] < MARK_LEVEL)) marked++
    }
  }
  return total ? (marked / total) * 100 : 0
}

/** Zero-based pages whose marked share is under the threshold. */
export function blankPages(ink: number[], thresholdPercent: number): number[] {
  const out: number[] = []
  ink.forEach((v, i) => {
    if (v < thresholdPercent) out.push(i)
  })
  return out
}

/** The pages that will go: blank ones, less those kept by hand. Refuses to remove every page. */
export function pagesToDelete(ink: number[], thresholdPercent: number, kept: ReadonlySet<number>): { pages: number[]; error: string | null } {
  const pages = blankPages(ink, thresholdPercent).filter((p) => !kept.has(p))
  if (!pages.length) return { pages, error: 'No pages are blank at this setting.' }
  if (pages.length >= ink.length)
    return {
      pages,
      error: 'Every page would be deleted. A document must keep at least one page.'
    }
  return { pages, error: null }
}
