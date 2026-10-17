/**
 * Join pages: two pages become one, side by side (two half pages that belong together) or one above the other.
 * The first page of each pair is rebuilt in place (so bookmarks and links to it still work) and the second is removed.
 * Comments and form fields on the joined pages are drawn into the new page from their appearances, so they stay
 * visible but can no longer be edited.
 */
import { PDFDocument, PDFName, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFPage } from 'pdf-lib'
import { drawAnnotations, mul, pageGeometry, turnMatrix } from './printVector'

export type JoinMode = 'side' | 'stack'

export interface JoinPlan {
  /** 0-based pairs: the first page keeps its place, the second is removed. */
  pairs: [number, number][]
  /** An odd page at the end of the selection, left as it is. */
  left: number | null
}

/** Pairs the chosen pages two at a time, in page order. */
export function planJoin(pages: number[]): JoinPlan {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const pairs: [number, number][] = []
  for (let i = 0; i + 1 < sorted.length; i += 2) pairs.push([sorted[i], sorted[i + 1]])
  return { pairs, left: sorted.length % 2 ? sorted[sorted.length - 1] : null }
}

/** Size of the joined page for two shown sizes. */
export function joinedSize(a: { w: number; h: number }, b: { w: number; h: number }, mode: JoinMode): { w: number; h: number } {
  return mode === 'side' ? { w: a.w + b.w, h: Math.max(a.h, b.h) } : { w: Math.max(a.w, b.w), h: a.h + b.h }
}

/**
 * Joins the chosen pages two at a time. `reversed` puts the second page of a pair first (on the left, or on top), as
 * for right-to-left books. Throws when fewer than two pages are chosen.
 */
export async function joinPages(bytes: Uint8Array, pages: number[], mode: JoinMode, reversed = false): Promise<{ bytes: Uint8Array; joined: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const plan = planJoin(pages.filter((p) => p >= 0 && p < doc.getPageCount()))
  if (!plan.pairs.length) throw new Error('Choose at least two pages to join.')
  const all = doc.getPages()
  // Embed every page first: the first page of a pair is rewritten afterwards.
  const used = plan.pairs.flat()
  for (const i of used) {
    const page = all[i]
    if (!page.node.has(PDFName.of('Contents'))) page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream('')))
    drawAnnotations(doc, page)
  }
  const geo = used.map((i) => pageGeometry(all[i]))
  const embedded = await doc.embedPages(
    used.map((i) => all[i]),
    geo.map((g) => g.box)
  )
  // pdf-lib copies a page's content when the file is saved unless told to now: do it before the first pages are rewritten.
  await Promise.all(embedded.map((e) => e.embed()))
  const shown = (g: (typeof geo)[number]) => (g.rot === 90 || g.rot === 270 ? { w: g.h, h: g.w } : { w: g.w, h: g.h })
  plan.pairs.forEach(([first], k) => {
    const parts = [0, 1].map((n) => ({ g: geo[2 * k + n], e: embedded[2 * k + n] }))
    if (reversed) parts.reverse()
    const sizes = parts.map((p) => shown(p.g))
    const size = joinedSize(sizes[0], sizes[1], mode)
    const target: PDFPage = all[first]
    // Rebuild the first page: fresh resources, content and boxes; its own comments are now part of the content.
    for (const key of ['Rotate', 'CropBox', 'TrimBox', 'BleedBox', 'ArtBox', 'Annots', 'Resources', 'Contents', 'Thumb']) target.node.delete(PDFName.of(key))
    // pdf-lib's page model expects these dictionaries to be there once the page has been looked at.
    target.node.set(PDFName.of('Resources'), doc.context.obj({ Font: {}, XObject: {}, ExtGState: {} }))
    target.node.set(PDFName.of('Annots'), doc.context.obj([]))
    target.setMediaBox(0, 0, size.w, size.h)
    ;(target as unknown as { getContentStream: (useExisting: boolean) => unknown }).getContentStream(false) // a new content stream: the old one is no longer referenced
    parts.forEach((p, n) => {
      const sz = sizes[n]
      // Centred across the joined direction; the first part sits at the left (or the top).
      const x = mode === 'side' ? (n === 0 ? 0 : sizes[0].w) : (size.w - sz.w) / 2
      const top = mode === 'side' ? (size.h - sz.h) / 2 : n === 0 ? 0 : sizes[0].h
      const m = mul(turnMatrix(p.g.w, p.g.h, p.g.rot), [1, 0, 0, 1, x, size.h - top - sz.h])
      const key = target.node.newXObject('JoinPage', p.e.ref)
      target.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(key), popGraphicsState())
    })
  })
  // Remove the second pages from the last to the first so the indexes stay right.
  for (const [, second] of [...plan.pairs].reverse()) doc.removePage(second)
  return { bytes: await doc.save(), joined: plan.pairs.length }
}
