/**
 * Flatten: make form fields and annotations part of the page content so they can no longer be edited.
 * Form fields go through pdf-lib's own flatten (see forms.ts); annotations are drawn from their normal
 * appearance stream (ISO 32000-1 12.5.5) and then removed.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib'
import { flattenForm } from './forms'

export type FlattenWhat = 'fields' | 'annots' | 'both'

const nums = (a: PDFArray | undefined, n: number): number[] | null => {
  if (!a || a.size() < n) return null
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const v = a.lookupMaybe(i, PDFNumber)
    if (!v) return null
    out.push(v.asNumber())
  }
  return out
}

/** Maps an appearance stream's transformed bounding box onto the annotation's rectangle (12.5.5, algorithm 8.1). */
export function appearanceMatrix(bbox: number[], matrix: number[], rect: number[]): number[] {
  const [x0, y0, x1, y1] = bbox
  const [a, b, c, d, e, f] = matrix
  const xs: number[] = []
  const ys: number[] = []
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    xs.push(a * x + c * y + e)
    ys.push(b * x + d * y + f)
  }
  const tx0 = Math.min(...xs)
  const ty0 = Math.min(...ys)
  const tw = Math.max(...xs) - tx0
  const th = Math.max(...ys) - ty0
  const rx0 = Math.min(rect[0], rect[2])
  const ry0 = Math.min(rect[1], rect[3])
  const sx = tw > 0 ? Math.abs(rect[2] - rect[0]) / tw : 1
  const sy = th > 0 ? Math.abs(rect[3] - rect[1]) / th : 1
  return [sx, 0, 0, sy, rx0 - tx0 * sx, ry0 - ty0 * sy]
}

/** Draws every visible annotation (not links, form fields or pop-ups) on `pages` into its page and removes it. */
export async function flattenAnnotations(bytes: Uint8Array, pages: number[]): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const list = doc.getPages()
  let count = 0
  for (const p of new Set(pages)) {
    const page = list[p]
    const annots = page?.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!page || !annots) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const dict = annots.lookupMaybe(i, PDFDict)
      if (!dict) continue
      const subtype = dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText()
      if (subtype === 'Link' || subtype === 'Widget') continue
      if (subtype === 'Popup') {
        annots.remove(i)
        continue
      }
      const flags = dict.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0
      if (flags & (2 | 32)) continue // Hidden or NoView: not shown, so nothing to draw (left as it is)
      const ap = dict.lookupMaybe(PDFName.of('AP'), PDFDict)
      let n = ap?.get(PDFName.of('N'))
      if (n instanceof PDFRef && !(doc.context.lookup(n) instanceof PDFStream)) {
        // A dictionary of states: the current one is named by /AS.
        const states = doc.context.lookup(n)
        const as = dict.lookupMaybe(PDFName.of('AS'), PDFName)
        n = states instanceof PDFDict && as ? states.get(as) : undefined
      } else if (n instanceof PDFDict && !(n instanceof PDFStream)) {
        const as = dict.lookupMaybe(PDFName.of('AS'), PDFName)
        n = as ? n.get(as) : undefined
      }
      const stream = n instanceof PDFRef ? doc.context.lookup(n) : undefined
      const rect = nums(dict.lookupMaybe(PDFName.of('Rect'), PDFArray), 4)
      if (!(n instanceof PDFRef) || !(stream instanceof PDFStream) || !rect) continue // no appearance to draw: left as it is
      const bbox = nums(stream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray), 4) ?? [0, 0, 1, 1]
      const matrix = nums(stream.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray), 6) ?? [1, 0, 0, 1, 0, 0]
      const m = appearanceMatrix(bbox, matrix, rect)
      const key = page.node.newXObject('FlatAnnot', n)
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(key), popGraphicsState())
      annots.remove(i)
      count++
    }
  }
  if (!count) return { bytes, count: 0 }
  return { bytes: await doc.save({ updateFieldAppearances: false }), count }
}

/** Flattens what was asked for on the given 0-based pages. */
export async function flattenDocument(bytes: Uint8Array, what: FlattenWhat, pages: number[]): Promise<{ bytes: Uint8Array; fields: number; annots: number }> {
  let cur = bytes
  let fields = 0
  let annots = 0
  if (what !== 'annots') {
    const r = await flattenForm(cur, pages)
    cur = r.bytes
    fields = r.count
  }
  if (what !== 'fields') {
    const r = await flattenAnnotations(cur, pages)
    cur = r.bytes
    annots = r.count
  }
  return { bytes: cur, fields, annots }
}
