/**
 * Edit vector paths already on a page (lines, rectangles, curves, fills): move, resize or delete. PDFium says which
 * path object was picked (the k-th painted path of the page is the k-th painting operator of its content stream);
 * the run of path operators is then wrapped in a `cm` that carries the change, or taken out. Same approach as images.
 */
import { PDFDict, PDFDocument, PDFName, type PDFPage } from 'pdf-lib'
import { cmOp, matInverse, matMul, num, parseContent, pathDraws, removeOps, stringToBytes, type Matrix6, type PathDraw } from './content'
import { clampOpacity, hexToUnit } from './objectOps'
import { addOpacityState, pageContent } from './pageContent'
import { pageResources } from './docStreams'

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

const BUILD_OPS = new Set(['m', 'l', 'c', 'v', 'y', 're', 'h'])
const STATE_OPS = new Set(['g', 'rg', 'k', 'G', 'RG', 'K', 'cs', 'CS', 'sc', 'scn', 'SC', 'SCN', 'w', 'gs'])

export interface PathRestyle {
  /** New stroke colour, #rrggbb. Ignored (with a message) when the path is not stroked. */
  stroke?: string
  /** New fill colour, #rrggbb. Ignored when the path is not filled. */
  fill?: string
  /** New line width in the path's own units (before its matrix). */
  lineWidth?: number
  /** Opacity for the fill and the stroke, 0 to 1. */
  opacity?: number
  /** Dash pattern in the path's own units (before its matrix): `on` drawn, `off` gap; 'solid' removes dashes. */
  dash?: { on: number; off: number } | 'solid'
  /** A two-colour gradient instead of a flat fill, running at `angle` degrees anticlockwise from left to right (page space). */
  gradient?: { from: string; to: string; angle: number }
}

/** The line along which a gradient runs across a box (page space): through its centre, as long as the box is in that direction. */
export function gradientAxis(box: { x0: number; y0: number; x1: number; y1: number }, angleDeg: number): [number, number, number, number] {
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const dx = Math.cos((angleDeg * Math.PI) / 180)
  const dy = Math.sin((angleDeg * Math.PI) / 180)
  const half = (Math.abs(dx) * (box.x1 - box.x0) + Math.abs(dy) * (box.y1 - box.y0)) / 2
  return [cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half]
}

/** Registers an axial shading in the page's resources and returns its name. */
function addAxialShading(doc: PDFDocument, page: PDFPage, coords: number[], from: [number, number, number], to: [number, number, number]): string {
  const ctx = doc.context
  const key = `OPSh${Math.random().toString(36).slice(2, 10)}`
  const shading = ctx.register(ctx.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: coords, Function: { FunctionType: 2, Domain: [0, 1], C0: from, C1: to, N: 1 }, Extend: [true, true] }))
  let res = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict)
  if (!res) {
    const inherited = pageResources(page)
    res = inherited ? inherited.clone(ctx) : (ctx.obj({}) as PDFDict)
    page.node.set(PDFName.of('Resources'), res)
  }
  let group = res.lookupMaybe(PDFName.of('Shading'), PDFDict)
  if (!group) {
    group = ctx.obj({}) as PDFDict
    res.set(PDFName.of('Shading'), group)
  }
  group.set(PDFName.of(key), shading)
  return key
}

/**
 * Changes how one painted path looks: stroke colour, fill colour, line width or opacity. The path's operators are
 * wrapped in `q ... Q` with the new settings in front, so nothing else on the page is touched. A stroke colour on a
 * path that is only filled (or a fill colour on one that is only stroked) would have no effect, so it is refused.
 */
export async function restylePath(bytes: Uint8Array, t: PathEditTarget, change: PathRestyle): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const page = doc.getPage(t.page)
  const { src, ops, draw } = locate(doc, t)
  if (change.stroke !== undefined && !draw.stroked) throw new Error('This shape is not outlined, so it has no line colour to change.')
  if (change.fill !== undefined && !draw.filled) throw new Error('This shape is not filled, so it has no fill colour to change.')
  if (change.lineWidth !== undefined && !draw.stroked) throw new Error('This shape is not outlined, so it has no line width to change.')
  let prefix = ''
  if (change.lineWidth !== undefined) {
    if (!(change.lineWidth >= 0) || !Number.isFinite(change.lineWidth)) throw new Error('The line width must be zero or more.')
    prefix += `${num(change.lineWidth)} w `
  }
  if (change.stroke !== undefined) {
    const c = hexToUnit(change.stroke)
    if (!c) throw new Error('That is not a colour.')
    prefix += `${c.map(num).join(' ')} RG `
  }
  if (change.fill !== undefined) {
    const c = hexToUnit(change.fill)
    if (!c) throw new Error('That is not a colour.')
    prefix += `${c.map(num).join(' ')} rg `
  }
  if (change.opacity !== undefined) prefix += `/${addOpacityState(doc, page, clampOpacity(change.opacity))} gs `
  if (change.dash !== undefined) {
    if (!draw.stroked) throw new Error('This shape is not outlined, so it has no line to dash.')
    if (change.dash === 'solid') prefix += '[] 0 d '
    else {
      if (!(change.dash.on > 0) || !(change.dash.off >= 0) || !Number.isFinite(change.dash.on + change.dash.off)) throw new Error('A dash needs a length above zero and a gap of zero or more.')
      prefix += `[${num(change.dash.on)} ${num(change.dash.off)}] 0 d `
    }
  }
  const from = ops[draw.first].start
  const to = ops[draw.paint].end
  if (change.gradient !== undefined) {
    if (!draw.filled) throw new Error('This shape is not filled, so it has no fill to make a gradient of.')
    const c0 = hexToUnit(change.gradient.from)
    const c1 = hexToUnit(change.gradient.to)
    const inv = matInverse(draw.ctm)
    if (!c0 || !c1) throw new Error('That is not a colour.')
    if (!inv) throw new Error('This shape cannot be given a gradient.')
    const [px0, py0, px1, py1] = gradientAxis(draw.bbox, change.gradient.angle)
    const at = (x: number, y: number): [number, number] => [x * inv[0] + y * inv[2] + inv[4], x * inv[1] + y * inv[3] + inv[5]]
    const [ux0, uy0] = at(px0, py0)
    const [ux1, uy1] = at(px1, py1)
    const name = addAxialShading(doc, page, [ux0, uy0, ux1, uy1].map((v) => Math.round(v * 1000) / 1000), c0, c1)
    const paint = ops[draw.paint].op
    const evenOdd = paint === 'f*' || paint === 'B*' || paint === 'b*'
    // The outline of the shape without any colour or width settings that sit among its operators.
    const construct = ops
      .slice(draw.first, draw.paint)
      .filter((o) => BUILD_OPS.has(o.op))
      .map((o) => src.slice(o.start, o.end))
      .join(' ')
    const closes = paint === 's' || paint === 'b' || paint === 'b*'
    const paintAt = ops[draw.paint].start
    const late = ops.slice(draw.first, draw.paint).some((o) => STATE_OPS.has(o.op))
    const original = src.slice(from, paintAt)
    // The gradient fills inside the path (as a clip); an outline, if there is one, is drawn on top with the old settings.
    const fillPart = `q ${construct} ${evenOdd ? 'W*' : 'W'} n /${name} sh Q`
    const strokePart = draw.stroked ? ` ${original}${late ? prefix : ''}${closes ? 's' : 'S'}` : ''
    const ctx2 = doc.context
    page.node.set(PDFName.of('Contents'), ctx2.register(ctx2.flateStream(stringToBytes(`${src.slice(0, from)}q ${prefix}${fillPart}${strokePart} Q${src.slice(to)}`))))
    return doc.save()
  }
  if (!prefix) return bytes
  // Some writers set colours and the width after the path and just before painting it: ours must come last then.
  const late = ops.slice(draw.first, draw.paint).some((o) => STATE_OPS.has(o.op))
  const at = ops[draw.paint].start
  const body = late ? `${src.slice(from, at)}${prefix}${src.slice(at, to)}` : `${prefix}${src.slice(from, to)}`
  const ctx = doc.context
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(stringToBytes(`${src.slice(0, from)}q ${body} Q${src.slice(to)}`))))
  return doc.save()
}
