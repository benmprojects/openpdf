/**
 * Split pages: cuts each chosen page into a grid of tiles, each tile a page of its own that shows its part of the
 * original through a crop box. The page content is shared between the tiles (nothing is copied or redrawn), so the
 * file stays about the same size and text and vector detail are kept exactly.
 */
import { PDFArray, type PDFContext, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFPage, PDFPageLeaf, PDFRef } from 'pdf-lib'
import { frameOf } from './pageMarks'
import { gridTiles, mmToPt, tilesForPaper, type PaperOrientation, type Tile } from '../../shared/tiling'

export type SplitPlan =
  | { kind: 'grid'; rows: number; cols: number; overlapMm: number }
  /** Pieces no bigger than this paper (mm, either way round) at actual size. */
  | { kind: 'paper'; paperW: number; paperH: number; overlapMm: number; orientation: PaperOrientation }

/** The tiles a plan makes of a page of this displayed size (points). */
export function planTiles(pageW: number, pageH: number, plan: SplitPlan): { cols: number; rows: number; tiles: Tile[] } {
  if (plan.kind === 'grid') return gridTiles(pageW, pageH, plan.cols, plan.rows, mmToPt(plan.overlapMm))
  return tilesForPaper(pageW, pageH, mmToPt(plan.paperW), mmToPt(plan.paperH), mmToPt(plan.overlapMm), plan.orientation)
}

/** A copy of a direct object (arrays and dictionaries are copied all the way down; references are kept). */
function copyDirect(o: PDFObject, ctx: PDFContext): PDFObject {
  if (o instanceof PDFRef) return o
  if (o instanceof PDFArray) {
    const out = PDFArray.withContext(ctx)
    for (let i = 0; i < o.size(); i++) out.push(copyDirect(o.get(i), ctx))
    return out
  }
  if (o instanceof PDFDict) {
    const out = PDFDict.withContext(ctx)
    for (const [k, v] of o.entries()) out.set(k, copyDirect(v, ctx))
    return out
  }
  return o
}

const nums = (a: PDFArray | undefined): number[] => (a ? Array.from({ length: a.size() }, (_, i) => (a.lookup(i, PDFNumber) as PDFNumber).asNumber()) : [])

/** Splits the pages (zero-based) of a document. Returns the new bytes and how many pages each one became. */
export async function splitPages(bytes: Uint8Array, pages: number[], plan: SplitPlan): Promise<{ bytes: Uint8Array; made: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  let made = 0
  for (const pi of [...new Set(pages)].filter((p) => p >= 0 && p < doc.getPageCount()).sort((a, b) => b - a)) {
    const page = doc.getPage(pi)
    const { f, w, h } = frameOf(page)
    const grid = planTiles(w, h, plan)
    if (grid.tiles.length < 2) continue
    page.node.normalize() // the inherited boxes, resources and rotation now belong to the page itself
    const mb = page.getMediaBox()
    const [a, b, c, d, e, g] = f.m
    const userBox = (t: Tile) => {
      const pts = [
        [t.x, t.y],
        [t.x + t.w, t.y],
        [t.x, t.y + t.h],
        [t.x + t.w, t.y + t.h]
      ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + g])
      const x0 = Math.max(mb.x, Math.min(...pts.map((p) => p[0])))
      const y0 = Math.max(mb.y, Math.min(...pts.map((p) => p[1])))
      const x1 = Math.min(mb.x + mb.width, Math.max(...pts.map((p) => p[0])))
      const y1 = Math.min(mb.y + mb.height, Math.max(...pts.map((p) => p[1])))
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    const boxes = grid.tiles.map(userBox)

    // Each annotation goes to the one tile its centre is in.
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    const owned: PDFObject[][] = boxes.map(() => [])
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const ref = annots!.get(i)
      const rect = nums(annots!.lookupMaybe(i, PDFDict)?.lookupMaybe(PDFName.of('Rect'), PDFArray))
      let owner = 0
      if (rect.length >= 4) {
        const cx = (rect[0] + rect[2]) / 2
        const cy = (rect[1] + rect[3]) / 2
        const hit = boxes.findIndex((bx) => cx >= bx.x && cx <= bx.x + bx.w && cy >= bx.y && cy <= bx.y + bx.h)
        owner = hit < 0 ? 0 : hit
      }
      owned[owner].push(ref)
    }

    const clones: PDFPage[] = []
    for (let k = 1; k < boxes.length; k++) {
      const map = new Map<PDFName, PDFObject>()
      for (const [key, value] of page.node.entries()) {
        if (key === PDFName.of('Parent') || key === PDFName.of('Annots')) continue
        map.set(key, copyDirect(value, doc.context))
      }
      const leaf = PDFPageLeaf.fromMapWithContext(map, doc.context, false)
      const ref = doc.context.register(leaf)
      clones.push(PDFPage.of(leaf, ref, doc))
    }
    const all = [page, ...clones]
    all.forEach((p, k) => {
      p.setCropBox(boxes[k].x, boxes[k].y, boxes[k].w, boxes[k].h)
      if (annots) {
        if (owned[k].length) {
          p.node.set(PDFName.of('Annots'), doc.context.obj(owned[k]))
          for (const r of owned[k]) if (r instanceof PDFRef) doc.context.lookupMaybe(r, PDFDict)?.set(PDFName.of('P'), p.ref)
        } else p.node.delete(PDFName.of('Annots'))
      }
    })
    clones.forEach((p, k) => doc.insertPage(pi + 1 + k, p))
    made += clones.length
  }
  return { bytes: await doc.save(), made }
}
