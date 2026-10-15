/**
 * Edit vector paths already on a page (lines, rectangles, curves, fills): move, resize or delete. PDFium says which
 * path object was picked (the k-th painted path of the page is the k-th painting operator of its content stream);
 * the run of path operators is then wrapped in a `cm` that carries the change, or taken out. Same approach as images.
 */
import { PDFDocument, PDFName, type PDFPage } from 'pdf-lib'
import { cmOp, matInverse, matMul, parseContent, pathDraws, removeOps, stringToBytes, type Matrix6, type PathDraw } from './content'
import { pageContent } from './pageContent'

export interface PathEditTarget {
  page: number
  /** Which painted path of the page (as PDFium counts them). */
  ordinal: number
  /** How many painted paths PDFium found on the page; must equal the content stream's count. */
  total: number
  /** PDFium's box for the path in page space: left, bottom, right, top. */
  pageBounds: [number, number, number, number]
}

function locate(doc: PDFDocument, t: PathEditTarget): { src: string; ops: ReturnType<typeof parseContent>; draw: PathDraw; page: PDFPage } {
  const page = doc.getPage(t.page)
  const src = pageContent(page)
  const ops = parseContent(src)
  const draws = pathDraws(ops)
  if (draws.length !== t.total) throw new Error('The drawing on this page cannot be edited safely (its content did not match).')
  const draw = draws[t.ordinal]
  if (!draw) throw new Error('That shape could not be found in the page content.')
  const [l, b, r, top] = t.pageBounds
  if (Math.abs((l + r) / 2 - (draw.bbox.x0 + draw.bbox.x1) / 2) > 3 || Math.abs((b + top) / 2 - (draw.bbox.y0 + draw.bbox.y1) / 2) > 3) throw new Error('The page changed under the edit; select the shape again.')
  if (draw.clips) throw new Error('This shape also sets a clipping area, so it cannot be moved or deleted on its own.')
  return { src, ops, draw, page }
}

/** `change` is an affine matrix in page space applied after the path is placed (a move or a scale); null deletes it. */
export async function transformPath(bytes: Uint8Array, t: PathEditTarget, change: Matrix6 | null): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { src, ops, draw, page } = locate(doc, t)
  let out: string
  if (change === null) out = removeOps(src, ops, new Set(Array.from({ length: draw.paint - draw.first + 1 }, (_, k) => draw.first + k)))
  else {
    const inv = matInverse(draw.ctm)
    if (!inv) throw new Error('This shape cannot be moved.')
    const m = matMul(matMul(draw.ctm, change), inv)
    const from = ops[draw.first].start
    const to = ops[draw.paint].end
    out = `${src.slice(0, from)}q ${cmOp(m)} ${src.slice(from, to)} Q${src.slice(to)}`
  }
  const ctx = doc.context
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(stringToBytes(out))))
  return doc.save()
}
