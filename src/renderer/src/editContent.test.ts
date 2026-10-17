import { deflateSync } from 'node:zlib'
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { imageDraws, parseContent, pathDraws } from './content'
import { bringForward, deleteForm, hideObject, listPageObjects, sendBackward, showObject } from './contentObjectsDoc'
import { bridgeState, listObjects, moveAfter, stateBefore } from './contentObjects'
import { buildCodec, listPageFonts, openPageFont, parseToUnicode, winAnsiMap } from './embeddedFont'
import { cropImage, setImageOpacity, type ImageEditTarget } from './imageEdit'
import { clipPolygonOps, flipHorizontal, flipVertical, hexToUnit, insetCornersToPage, lineWidthForWrite, lineWidthInPoints, matrixScale, rotateAbout, applyMatrix } from './objectOps'
import { isImageXObject, pageContent, setPageContent } from './pageContent'
import { restylePath, type PathEditTarget } from './pathEdit'
import { familyOf, formatIsEmpty, pickStandardFont, replaceBlock, standardFor, type TextStyle } from './textEdit'

function png(w: number, h: number): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, w)
  hv.setUint32(4, h)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const raw = new Uint8Array(h * (1 + w * 3))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([200, 60, 60], y * (1 + w * 3) + 1 + x * 3)
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return all
}

const near = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps)

describe('objectOps', () => {
  it('turns a point a quarter turn clockwise on screen about a centre', () => {
    const m = rotateAbout(90, 50, 50)
    expect(near(applyMatrix(m, [60, 50]), [50, 60])).toBe(true)
    expect(near(applyMatrix(m, [50, 50]), [50, 50])).toBe(true)
  })

  it('a half turn equals both flips', () => {
    const half = rotateAbout(180, 30, 20)
    const flipped = applyMatrix(flipVertical(20), applyMatrix(flipHorizontal(30), [40, 25]))
    expect(near(applyMatrix(half, [40, 25]), flipped)).toBe(true)
  })

  it('insets a display rectangle and maps its corners to page space', () => {
    // Display y runs down; the page space here is y up with a 100-high page.
    const toPage: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 100]
    const c = insetCornersToPage({ x: 10, y: 10, w: 40, h: 20 }, { left: 5, top: 5, right: 0, bottom: 5 }, toPage)!
    expect(c).toEqual([[15, 85], [50, 85], [50, 75], [15, 75]])
    expect(insetCornersToPage({ x: 0, y: 0, w: 10, h: 10 }, { left: 6, top: 0, right: 6, bottom: 0 }, toPage)).toBeNull()
    expect(clipPolygonOps([[0, 0], [1, 0], [1, 1]], String)).toBe('0 0 m 1 0 l 1 1 l h W n')
  })

  it('reads line widths through the matrix and colours as numbers', () => {
    expect(matrixScale([2, 0, 0, 2, 5, 5])).toBe(2)
    expect(lineWidthForWrite(3, [2, 0, 0, 2, 0, 0])).toBe(1.5)
    expect(lineWidthInPoints(1.5, [2, 0, 0, 2, 0, 0])).toBe(3)
    expect(hexToUnit('#ff8000')).toEqual([1, 128 / 255, 0])
    expect(hexToUnit('red')).toBeNull()
  })
})

describe('text format choices', () => {
  it('chooses standard fonts by family, bold and italic', () => {
    expect(standardFor('helvetica', true, false)).toBe(StandardFonts.HelveticaBold)
    expect(standardFor('times', false, true)).toBe(StandardFonts.TimesRomanItalic)
    expect(standardFor('courier', true, true)).toBe(StandardFonts.CourierBoldOblique)
    expect(standardFor('symbol', true, true)).toBe(StandardFonts.Symbol)
    expect(familyOf({ font: 'TimesNewRoman', flags: 0 })).toBe('times')
    expect(pickStandardFont({ font: 'Arial-BoldMT', flags: 0, weight: 400, italic: false })).toBe(StandardFonts.HelveticaBold)
    expect(formatIsEmpty({})).toBe(true)
    expect(formatIsEmpty({ size: 12 })).toBe(false)
  })
})

async function imagePdf(): Promise<{ bytes: Uint8Array; target: ImageEditTarget }> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const img = await doc.embedPng(png(10, 10))
  page.drawImage(img, { x: 100, y: 100, width: 200, height: 100 })
  const bytes = await doc.save()
  return { bytes, target: { page: 0, ordinal: 0, total: 1, matrix: [200, 0, 0, 100, 100, 100] } }
}

describe('image crop and opacity', () => {
  it('crops through a clip written in the picture\'s own square', async () => {
    const { bytes, target } = await imagePdf()
    // Keep the left half: page-space corners (100,100) to (200,200).
    const out = await cropImage(bytes, target, [[100, 100], [200, 100], [200, 200], [100, 200]])
    const doc = await PDFDocument.load(out)
    const page = doc.getPage(0)
    const src = pageContent(page)
    expect(src).toContain('0 0 m 0.5 0 l 0.5 1 l 0 1 l h W n')
    const draws = imageDraws(parseContent(src), (n) => isImageXObject(page, n))
    expect(draws).toHaveLength(1)
    expect(near(draws[0].ctm, [200, 0, 0, 100, 100, 100])).toBe(true)
  })

  it('draws a picture at a given opacity', async () => {
    const { bytes, target } = await imagePdf()
    const out = await setImageOpacity(bytes, target, 0.4)
    const doc = await PDFDocument.load(out)
    const src = pageContent(doc.getPage(0))
    expect(src).toMatch(/q \/OPAlpha\w+ gs/)
    const gs = doc.getPage(0).node.normalizedEntries().ExtGState!
    expect(gs.entries().length).toBe(1)
    expect(gs.entries()[0][1].toString()).toBeTruthy()
  })
})

async function shapesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  page.drawRectangle({ x: 50, y: 60, width: 100, height: 40, color: rgb(1, 0, 0) })
  page.drawRectangle({ x: 200, y: 60, width: 100, height: 40, color: rgb(0, 0, 1) })
  page.drawLine({ start: { x: 200, y: 200 }, end: { x: 300, y: 260 }, thickness: 2, color: rgb(0, 0, 0) })
  return doc.save()
}
const redBox: PathEditTarget = { page: 0, ordinal: 0, total: 3, pageBounds: [50, 60, 150, 100] }
const edge: PathEditTarget = { page: 0, ordinal: 2, total: 3, pageBounds: [199, 199, 301, 261] }

describe('restylePath', () => {
  it('recolours a fill and keeps the geometry', async () => {
    const out = await restylePath(await shapesPdf(), redBox, { fill: '#00ff00' })
    const d = pathDraws(parseContent(pageContent((await PDFDocument.load(out)).getPage(0))))
    expect(d).toHaveLength(3)
    expect(d[0].fill).toEqual([0, 1, 0])
    expect(d[0].bbox).toMatchObject({ x0: 50, y0: 60, x1: 150, y1: 100 })
    expect(d[1].fill).toEqual([0, 0, 1])
  })

  it('changes the line colour and width of a line, and opacity', async () => {
    const out = await restylePath(await shapesPdf(), edge, { stroke: '#ff0000', lineWidth: 5, opacity: 0.5 })
    const src = pageContent((await PDFDocument.load(out)).getPage(0))
    expect(src).toContain('5 w 1 0 0 RG')
    expect(src).toMatch(/\/OPAlpha\w+ gs/)
  })

  it('wins over colours the writer set after the path, just before painting', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 400])
    setPageContent(doc, page, 'q 100 262 120 80 re 3 w h 0 0 1 RG 1 0 0 rg B Q')
    const bytes = await doc.save()
    const out = await restylePath(bytes, { page: 0, ordinal: 0, total: 1, pageBounds: [100, 262, 220, 342] }, { fill: '#00ff00', stroke: '#ffff00', lineWidth: 8 })
    const src = pageContent((await PDFDocument.load(out)).getPage(0))
    expect(src.indexOf('0 1 0 rg')).toBeGreaterThan(src.indexOf('1 0 0 rg'))
    expect(src.indexOf('8 w')).toBeGreaterThan(src.indexOf('3 w'))
    const d = pathDraws(parseContent(src))
    expect(d[0].fill).toEqual([0, 1, 0])
  })

  it('refuses a stroke colour on a shape that is only filled, and a fill on a line', async () => {
    await expect(restylePath(await shapesPdf(), redBox, { stroke: '#000000' })).rejects.toThrow(/not outlined/)
    await expect(restylePath(await shapesPdf(), edge, { fill: '#000000' })).rejects.toThrow(/not filled/)
    await expect(restylePath(await shapesPdf(), redBox, { fill: 'green' })).rejects.toThrow(/not a colour/)
  })
})

describe('content objects: listing, hiding and order', () => {
  it('lists shapes in drawing order with PDFium-style ordinals', async () => {
    const list = await listPageObjects(await shapesPdf(), 0)
    expect(list.map((o) => `${o.kind}${o.typeOrdinal}`)).toEqual(['path0', 'path1', 'path2'])
  })

  it('hides and shows an object through an optional content group', async () => {
    const bytes = await shapesPdf()
    const hidden = await hideObject(bytes, { page: 0, kind: 'path', typeOrdinal: 1 })
    const doc = await PDFDocument.load(hidden)
    expect(pageContent(doc.getPage(0))).toMatch(/\/OC \/OPHide\w+ BDC/)
    const list = await listPageObjects(hidden, 0)
    expect(list.map((o) => !!o.hiddenBy)).toEqual([false, true, false])
    expect(String(doc.catalog.lookup(PDFName.of('OCProperties')))).toContain('OFF')

    const shown = await showObject(hidden, { page: 0, kind: 'path', typeOrdinal: 1 })
    const list2 = await listPageObjects(shown, 0)
    expect(list2.every((o) => !o.hiddenBy)).toBe(true)
    expect(pageContent((await PDFDocument.load(shown)).getPage(0))).not.toContain('BDC')
    const props = String((await PDFDocument.load(shown)).catalog.lookup(PDFName.of('OCProperties')))
    expect(props).not.toMatch(/\d+ \d+ R/)
  })

  it('brings an object forward and sends it back, keeping where it is drawn', async () => {
    const bytes = await shapesPdf()
    const fwd = await bringForward(bytes, { page: 0, kind: 'path', typeOrdinal: 0 })
    let d = pathDraws(parseContent(pageContent((await PDFDocument.load(fwd)).getPage(0))))
    expect(d).toHaveLength(3)
    // The red box is now second in drawing order, at the same place and colour.
    expect(d[1].fill).toEqual([1, 0, 0])
    expect(d[1].bbox).toMatchObject({ x0: 50, y0: 60, x1: 150, y1: 100 })
    expect(d[0].fill).toEqual([0, 0, 1])
    expect(d[0].bbox).toMatchObject({ x0: 200, y0: 60, x1: 300, y1: 100 })

    const back = await sendBackward(fwd, { page: 0, kind: 'path', typeOrdinal: 1 })
    d = pathDraws(parseContent(pageContent((await PDFDocument.load(back)).getPage(0))))
    expect(d[0].fill).toEqual([1, 0, 0])
    expect(d[0].bbox).toMatchObject({ x0: 50, y0: 60, x1: 150, y1: 100 })
    await expect(sendBackward(bytes, { page: 0, kind: 'path', typeOrdinal: 0 })).rejects.toThrow(/already at the back/)
    await expect(bringForward(bytes, { page: 0, kind: 'path', typeOrdinal: 2 })).rejects.toThrow(/already in front/)
  })

  it('refuses to reorder across a different clip', () => {
    const src = 'q 0 0 50 50 re W n 1 0 0 rg 0 0 10 10 re f Q 0 0 1 rg 20 20 10 10 re f'
    const ops = parseContent(src)
    const objs = listObjects(ops, () => false, () => false)
    expect(objs).toHaveLength(2)
    const r = moveAfter(src, ops, objs[0], objs[1])
    expect('problem' in r && r.problem).toMatch(/clipped differently/)
  })

  it('bridges colours and the drawing matrix when it can', () => {
    const src = 'q 1 0 0 rg 2 0 0 2 10 10 cm 0 0 5 5 re f Q q 0 0 1 rg 0 0 5 5 re f Q'
    const ops = parseContent(src)
    const objs = listObjects(ops, () => false, () => false)
    const from = stateBefore(src, ops, objs[0].group.first)
    const to = stateBefore(src, ops, objs[1].group.last + 1)
    const r = bridgeState(from, to)
    expect('ops' in r && r.ops).toContain('1 0 0 rg')
    expect('ops' in r && r.ops).toContain('2 0 0 2 10 10 cm')
    const moved = moveAfter(src, ops, objs[0], objs[1])
    expect('src' in moved).toBe(true)
  })

  it('lists text and forms, and refuses to move text that shares a text object', () => {
    const src = 'BT /F1 12 Tf 10 10 Td (a) Tj (b) Tj ET BT /F1 12 Tf 10 30 Td (c) Tj ET /Fm1 Do'
    const ops = parseContent(src)
    const objs = listObjects(ops, () => false, (n) => n === 'Fm1')
    expect(objs.map((o) => o.kind)).toEqual(['text', 'text', 'text', 'form'])
    expect(objs[0].fixed).toMatch(/shares a text object/)
    expect(objs[2].fixed).toBeNull()
    const r = moveAfter(src, ops, objs[0], objs[2])
    expect('problem' in r).toBe(true)
  })

  it('deletes a form from the page', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    const form = doc.context.formXObject([], { BBox: [0, 0, 10, 10] } as never)
    page.node.setXObject(PDFName.of('Fm1'), doc.context.register(form))
    page.pushOperators()
    const bytes = await doc.save()
    const again = await PDFDocument.load(bytes)
    const p = again.getPage(0)
    // Draw it: `/Fm1 Do`.
    const { setPageContent } = await import('./pageContent')
    setPageContent(again, p, 'q 1 0 0 1 20 20 cm /Fm1 Do Q')
    const withForm = await again.save()
    expect((await listPageObjects(withForm, 0)).map((o) => o.kind)).toEqual(['form'])
    const out = await deleteForm(withForm, { page: 0, kind: 'form', typeOrdinal: 0 })
    expect(await listPageObjects(out, 0)).toEqual([])
  })
})

describe('page fonts', () => {
  it('reads ToUnicode maps', () => {
    const map = parseToUnicode('1 beginbfchar <0003> <0020> <0024> <0041> endbfchar 1 beginbfrange <0030> <0032> <0061> endbfrange 1 beginbfrange <0040> <0041> [<0078> <0079>] endbfrange')
    expect(map.get(3)).toBe(' ')
    expect(map.get(0x24)).toBe('A')
    expect(map.get(0x31)).toBe('b')
    expect(map.get(0x41)).toBe('y')
    expect(winAnsiMap().get(0x93)).toBe('“')
  })

  it('reports characters a subset font does not hold', () => {
    const info = { resource: 'F1', baseFont: 'Foo', subset: true, embedded: true, composite: false }
    const codec = buildCodec(info, { toUnicode: '2 beginbfchar <61> <0061> <62> <0062> endbfchar', winAnsi: true, widths: () => 500, bytesPerCode: 1 })
    expect(codec.encode('abba').missing).toEqual([])
    expect(codec.encode('abc').missing).toEqual(['c'])
    // The characters of the text being replaced are certainly in the subset.
    expect(codec.encode('abc', 'c').missing).toEqual([])
    expect(codec.widthOf('ab', 10)).toBe(10)
    const whole = buildCodec({ ...info, subset: false }, { winAnsi: true, widths: () => 500, bytesPerCode: 1 })
    expect(whole.encode('café €').missing).toEqual([])
    expect(whole.encode('中').missing).toEqual(['中'])
  })

  it('writes a block in a font the page already holds, and says so when a subset lacks a glyph', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 400])
    const helv = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Hello', { x: 50, y: 300, size: 14, font: helv })
    // A subset font dictionary that only holds "a" and "b".
    const ctx = doc.context
    const cmap = ctx.flateStream('1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <61> <0061> <62> <0062> endbfchar')
    const sub = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+Sample', Encoding: 'WinAnsiEncoding', FirstChar: 97, LastChar: 98, Widths: [600, 600], ToUnicode: ctx.register(cmap) }))
    page.node.setFontDictionary(PDFName.of('FSub'), sub)
    const bytes = await doc.save()

    const fonts = listPageFonts((await PDFDocument.load(bytes)).getPage(0))
    expect(fonts.map((f) => f.baseFont).sort()).toEqual(['Helvetica', 'Sample'])
    expect(fonts.find((f) => f.baseFont === 'Sample')?.subset).toBe(true)

    const style: TextStyle = { font: 'Helvetica', flags: 32, weight: 400, italic: false, size: 14, color: '#000000', matrix: [1, 0, 0, 1, 50, 300] }
    const target = { page: 0, ordinals: [0], total: 1, origins: [{ x: 50, y: 300 }] }
    const ok = await replaceBlock(bytes, target, 'abba', style, null, null, { pageFont: 'FSub', size: 20, color: '#ff0000' }, 'Hello')
    expect(ok.fontUsed).toBe('page')
    const src = pageContent((await PDFDocument.load(ok.bytes)).getPage(0))
    expect(src).toContain('/FSub 20 Tf')
    expect(src).toContain('<61626261> Tj')
    expect(src).toContain('1 0 0 rg')
    await expect(replaceBlock(bytes, target, 'abc', style, null, null, { pageFont: 'FSub' }, 'Hello')).rejects.toThrow(/subset.*"c"/)
    await expect(replaceBlock(bytes, target, 'abc', style, null, null, { pageFont: 'Nope' }, 'Hello')).rejects.toThrow(/no longer on the page/)
    // A standard font with bold and a new size and colour.
    const std = await replaceBlock(bytes, target, 'Hello', style, null, null, { family: 'times', bold: true, size: 30, color: '#0000ff' }, 'Hello')
    const out = pageContent((await PDFDocument.load(std.bytes)).getPage(0))
    expect(out).toContain('0 0 1 rg')
    expect(out).toMatch(/30 Tf/)
    const names = listPageFonts((await PDFDocument.load(std.bytes)).getPage(0)).map((f) => f.baseFont)
    expect(names).toContain('Times-Bold')
    expect(openPageFont((await PDFDocument.load(bytes)).getPage(0), 'FSub')).toHaveProperty('codec')
  })
})
