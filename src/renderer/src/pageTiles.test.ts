import { PDFDict, PDFDocument, PDFName, PDFStream, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { planTiles, splitPages } from './pageTiles'
import { mmToPt } from '../../shared/tiling'
import { marksPresent } from './pageMarks'
import { overlayPages, overlayPlacement, pairPages } from './overlay'
import { pageContent } from './pageContent'

async function make(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  sizes.forEach(([w, h], i) => doc.addPage([w, h]).drawText(`Sheet ${i + 1}`, { x: 20, y: 20 }))
  return doc.save()
}

describe('splitPages', () => {
  it('cuts a page into a grid of pages that show their own part', async () => {
    const out = await splitPages(await make([[600, 800], [200, 200]]), [0], { kind: 'grid', rows: 2, cols: 2, overlapMm: 0 })
    expect(out.made).toBe(3)
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getPageCount()).toBe(5)
    const boxes = [0, 1, 2, 3].map((i) => doc.getPage(i).getCropBox())
    expect(boxes.map((b) => [b.x, b.y, b.width, b.height])).toEqual([
      [0, 400, 300, 400], // top left (PDF origin is bottom left)
      [300, 400, 300, 400],
      [0, 0, 300, 400],
      [300, 0, 300, 400]
    ])
    // The page after the split is untouched, and the content is shared, not copied.
    expect(doc.getPage(4).getSize()).toEqual({ width: 200, height: 200 })
    expect(pageContent(doc.getPage(3))).toContain('Tj')
    expect(doc.getPage(0).node.get(PDFName.of('Contents'))).toBeDefined()
  })

  it('follows the rotation of the page: tile 1 is the top left as displayed', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([400, 200]).setRotation(degrees(90)) // displayed 200 wide, 400 tall
    const out = await splitPages(await doc.save(), [0], { kind: 'grid', rows: 2, cols: 1, overlapMm: 0 })
    const d = await PDFDocument.load(out.bytes)
    const a = d.getPage(0).getCropBox()
    const b = d.getPage(1).getCropBox()
    // Rotated a quarter turn clockwise, the left end of the unrotated page is at the top.
    expect([a.x, a.y, a.width, a.height]).toEqual([0, 0, 200, 200])
    expect([b.x, b.y, b.width, b.height]).toEqual([200, 0, 200, 200])
    expect(d.getPage(1).getRotation().angle).toBe(90)
  })

  it('cuts to paper sizes with an overlap', async () => {
    const out = await splitPages(await make([[mmToPt(594), mmToPt(841)]]), [0], { kind: 'paper', paperW: 297, paperH: 420, overlapMm: 10, orientation: 'portrait' })
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getPageCount()).toBe(9) // 3 x 3: 2 x 297 mm does not cover 594 mm once 10 mm is shared
    const [a, b] = [doc.getPage(0).getCropBox(), doc.getPage(1).getCropBox()]
    expect(a.x + a.width - b.x).toBeCloseTo(mmToPt(10), 1)
  })

  it('gives each comment to the tile it sits in', async () => {
    const pdf = await PDFDocument.load(await make([[600, 800]]))
    const annot = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [400, 100, 500, 200] }))
    pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([annot]))
    const out = await splitPages(await pdf.save(), [0], { kind: 'grid', rows: 2, cols: 2, overlapMm: 0 })
    const doc = await PDFDocument.load(out.bytes)
    const counts = [0, 1, 2, 3].map((i) => doc.getPage(i).node.Annots()?.size() ?? 0)
    expect(counts).toEqual([0, 0, 0, 1]) // bottom right
  })

  it('leaves a page that is already small enough', async () => {
    const out = await splitPages(await make([[200, 200]]), [0], { kind: 'paper', paperW: 297, paperH: 420, overlapMm: 0, orientation: 'auto' })
    expect(out.made).toBe(0)
  })

  it('plans tiles for the preview', () => {
    expect(planTiles(600, 400, { kind: 'grid', rows: 1, cols: 3, overlapMm: 0 }).tiles).toHaveLength(3)
  })
})

describe('overlay', () => {
  const spec = { pages: [0], sourcePages: [0], pairing: 'sequence' as const, behind: false, fit: 'fit' as const, align: 'mc' as const, offsetX: 0, offsetY: 0, opacity: 0.5, tint: null }

  it('places a page over another as a form XObject at the chosen opacity', async () => {
    const out = await overlayPages(await make([[300, 300], [300, 300]]), await make([[300, 300]]), spec)
    const doc = await PDFDocument.load(out)
    expect(pageContent(doc.getPage(0))).toContain('/OPOv')
    expect(pageContent(doc.getPage(1))).not.toContain('/OPOv')
    expect((await marksPresent(out)).has('Overlay')).toBe(true)
  })

  it('goes under the page content when asked', async () => {
    const out = await overlayPages(await make([[300, 300]]), await make([[300, 300]]), { ...spec, behind: true })
    const c = pageContent((await PDFDocument.load(out)).getPage(0))
    expect(c.indexOf('/OPOv')).toBeLessThan(c.indexOf('Tj'))
  })

  it('draws the overlay in a tint through a transparency group', async () => {
    const out = await overlayPages(await make([[300, 300]]), await make([[300, 300]]), { ...spec, tint: '#ff0000' })
    const c = pageContent((await PDFDocument.load(out)).getPage(0))
    expect(c).toContain('/OPOg')
    const page = (await PDFDocument.load(out)).getPage(0)
    const xo = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const group = xo.lookup(xo.keys().find((k) => k.decodeText().startsWith('OPOg'))!, PDFStream) as PDFStream
    expect(group.dict.has(PDFName.of('Group'))).toBe(true)
    const gs = page.node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict)
    const modes = gs.keys().map((k) => gs.lookup(k, PDFDict).get(PDFName.of('BM'))?.toString())
    expect(modes).toContain('/Multiply')
  })

  it('pairs pages in sequence, starting again when the source runs out', () => {
    expect(pairPages([0, 1, 2, 3], [5, 6], 'sequence')).toEqual([[0, 5], [1, 6], [2, 5], [3, 6]])
    expect(pairPages([2, 0], [5, 6], 'first')).toEqual([[0, 5], [2, 5]])
    expect(pairPages([0], [], 'sequence')).toEqual([])
  })

  it('works out scale and position', () => {
    expect(overlayPlacement(400, 200, 100, 100, { fit: 'fit', align: 'mc', offsetX: 0, offsetY: 0 })).toEqual({ s: 2, tx: 100, ty: 0 })
    expect(overlayPlacement(400, 200, 100, 100, { fit: 'fill', align: 'tl', offsetX: 5, offsetY: 7 })).toEqual({ s: 4, tx: 5, ty: 7 })
    expect(overlayPlacement(400, 200, 100, 50, { fit: 'actual', align: 'br', offsetX: 0, offsetY: 0 })).toEqual({ s: 1, tx: 300, ty: 150 })
  })

  it('refuses when nothing would be overlaid', async () => {
    await expect(overlayPages(await make([[300, 300]]), await make([[300, 300]]), { ...spec, pages: [5] })).rejects.toThrow('no pages')
  })
})
