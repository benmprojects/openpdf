/**
 * Edit images already on a page: move, resize, replace or delete. PDFium says which image object was picked (the k-th
 * image object of the page is the k-th image-drawing operation of its content stream); the stream's operation is then
 * wrapped in a `cm` that carries the change, swapped for a new picture, or taken out.
 */
import { PDFDocument, PDFName, type PDFPage } from 'pdf-lib'
import { cmOp, imageDraws, matInverse, matMul, parseContent, removeOps, stringToBytes, type ImageDraw, type Matrix6 } from './content'
import { isImageXObject, pageContent } from './pageContent'

export interface ImageEditTarget {
  /** Zero-based page. */
  page: number
  /** Which image object of the page (as PDFium counts them). */
  ordinal: number
  /** How many image objects PDFium found on the page; must equal the content stream's count. */
  total: number
  /** The object's matrix in page space, from PDFium; the stream's must agree. */
  matrix: Matrix6
}

export type { Matrix6 }

interface Located {
  src: string
  ops: ReturnType<typeof parseContent>
  draw: ImageDraw
  page: PDFPage
}

function locate(doc: PDFDocument, t: ImageEditTarget): Located {
  const page = doc.getPage(t.page)
  const src = pageContent(page)
  const ops = parseContent(src)
  const draws = imageDraws(ops, (n) => isImageXObject(page, n))
  if (draws.length !== t.total) throw new Error('The images on this page cannot be edited safely (its content did not match).')
  const draw = draws[t.ordinal]
  if (!draw) throw new Error('That image could not be found in the page content.')
  const close = draw.ctm.every((v, i) => Math.abs(v - t.matrix[i]) <= 0.5 + Math.abs(v) * 1e-3)
  if (!close) throw new Error('The page changed under the edit; select the image again.')
  return { src, ops, draw, page }
}

function setContent(doc: PDFDocument, page: PDFPage, src: string): void {
  const ctx = doc.context
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(stringToBytes(src))))
}

/**
 * Applies `change` (an affine matrix in page space, applied after the image is placed) to one image: a move is a
 * translation, a resize a scale about a point. `null` deletes the image.
 */
export async function transformImage(bytes: Uint8Array, t: ImageEditTarget, change: Matrix6 | null): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { src, ops, draw, page } = locate(doc, t)
  const op = ops[draw.index]
  let out: string
  if (change === null) out = removeOps(src, ops, new Set([draw.index]))
  else {
    const inv = matInverse(draw.ctm)
    if (!inv) throw new Error('This image has no area, so it cannot be moved.')
    // ctm x change x ctm^-1, so that the new transform is ctm x change.
    const m = matMul(matMul(draw.ctm, change), inv)
    out = `${src.slice(0, op.start)}q ${cmOp(m)} ${src.slice(op.start, op.end)} Q${src.slice(op.end)}`
  }
  setContent(doc, page, out)
  return doc.save()
}

/** Swaps one image for a PNG or JPEG, fitted inside the old image's box (aspect ratio kept, centred). */
export async function replaceImage(bytes: Uint8Array, t: ImageEditTarget, image: { data: Uint8Array; kind: 'png' | 'jpg' }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { src, ops, draw, page } = locate(doc, t)
  const op = ops[draw.index]
  const pic = image.kind === 'png' ? await doc.embedPng(image.data) : await doc.embedJpg(image.data)
  const key = `OPImg${Math.random().toString(36).slice(2, 10)}`
  page.node.setXObject(PDFName.of(key), pic.ref)
  // The old box on the page: width and height of the unit square's two sides.
  const [a, b, c, d] = draw.ctm
  const boxW = Math.hypot(a, b)
  const boxH = Math.hypot(c, d)
  const oldAspect = boxW / (boxH || 1)
  const newAspect = pic.width / pic.height
  const fit: Matrix6 = newAspect > oldAspect ? [1, 0, 0, oldAspect / newAspect, 0, (1 - oldAspect / newAspect) / 2] : [newAspect / oldAspect, 0, 0, 1, (1 - newAspect / oldAspect) / 2, 0]
  const out = `${src.slice(0, op.start)}q ${cmOp(fit)} /${key} Do Q${src.slice(op.end)}`
  setContent(doc, page, out)
  return doc.save()
}
