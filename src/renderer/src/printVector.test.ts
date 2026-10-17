import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib'
import { buildVectorPrint, turnMatrix } from './printVector'

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 4; i++) {
    const p = doc.addPage(i === 1 ? [800, 600] : [600, 800])
    p.drawText(`Page ${i + 1} text`, { x: 50, y: 700, size: 20, font })
  }
  doc.getPage(2).setRotation(degrees(90))
  doc.getPage(3).setCropBox(100, 100, 300, 400)
  return doc.save()
}

/** Every decoded content stream of the form XObjects in the file, joined. */
function formText(doc: PDFDocument): { text: string; images: number } {
  let text = ''
  let images = 0
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const sub = obj.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText()
    if (sub === 'Image') images++
    if (sub === 'Form') {
      text += new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode())
    }
  }
  return { text, images }
}

const base = { layout: { kind: 'single' as const }, scaling: { kind: 'fit' as const }, centre: true, landscape: false, paper: 'A4' as const, autoRotate: true }

describe('buildVectorPrint', () => {
  it('writes one sheet per page, as vector content with the text kept', async () => {
    const out = await buildVectorPrint(await sample(), { ...base, pages: [0, 1, 2, 3] })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(4)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
    const { text, images } = formText(doc)
    expect(images).toBe(0)
    // Text is still text: shown with Tj under a font, not drawn as a picture.
    expect(text).toContain(' Tf')
    expect(text).toContain(' Tj')
  })

  it('prints only the chosen pages, in the order given', async () => {
    const out = await buildVectorPrint(await sample(), { ...base, pages: [2, 0] })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
  })

  it('puts several pages on one sheet and pads booklets to a multiple of four', async () => {
    const two = await PDFDocument.load(await buildVectorPrint(await sample(), { ...base, landscape: true, layout: { kind: 'nup', perSheet: 2 }, pages: [0, 1, 2, 3] }))
    expect(two.getPageCount()).toBe(2)
    expect(Math.round(two.getPage(0).getSize().width)).toBe(842)
    const booklet = await PDFDocument.load(await buildVectorPrint(await sample(), { ...base, landscape: true, layout: { kind: 'booklet' }, pages: [0, 1, 2] }))
    expect(booklet.getPageCount()).toBe(2) // four pages' worth: front and back of one sheet
  })

  it('draws annotation appearances and removes the original pages, bookmarks and form', async () => {
    const src = await PDFDocument.load(await sample())
    const ap = src.context.flateStream('0 0 1 rg 0 0 10 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] })
    const annot = src.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 60, 60], F: 4, AP: { N: src.context.register(ap) } })
    src.getPage(0).node.set(PDFName.of('Annots'), src.context.obj([src.context.register(annot)]))
    src.catalog.set(PDFName.of('Outlines'), src.context.obj({ Type: 'Outlines' }))
    const out = await PDFDocument.load(await buildVectorPrint(await src.save(), { ...base, pages: [0] }))
    expect(out.getPageCount()).toBe(1)
    expect(out.catalog.has(PDFName.of('Outlines'))).toBe(false)
    expect(out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0)
    expect(formText(out).text).toContain('0 0 10 10 re')
  })

  it('refuses an empty list', async () => {
    await expect(buildVectorPrint(await sample(), { ...base, pages: [] })).rejects.toThrow(/no pages/i)
    await expect(buildVectorPrint(await sample(), { ...base, pages: [99] })).rejects.toThrow(/no pages/i)
  })

  it('keeps layers by working inside the document', async () => {
    const src = await PDFDocument.load(await sample())
    src.catalog.set(PDFName.of('OCProperties'), src.context.obj({ OCGs: [], D: {} }))
    const out = await PDFDocument.load(await buildVectorPrint(await src.save(), { ...base, pages: [0] }))
    expect(out.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)).toBeDefined()
    expect(out.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)?.lookupMaybe(PDFName.of('OCGs'), PDFArray)?.size()).toBe(0)
  })
})

describe('turnMatrix', () => {
  it('moves the corners of a turned box onto the origin', () => {
    const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
    // 90 clockwise on 200 x 100: the bottom-left corner goes to the top-left of the 100 x 200 result.
    expect(apply(turnMatrix(200, 100, 90), 0, 0)).toEqual([0, 200])
    expect(apply(turnMatrix(200, 100, 90), 200, 100)).toEqual([100, 0])
    expect(apply(turnMatrix(200, 100, 180), 0, 0)).toEqual([200, 100])
    expect(apply(turnMatrix(200, 100, 270), 0, 0)).toEqual([100, 0])
    expect(apply(turnMatrix(200, 100, 0), 5, 6)).toEqual([5, 6])
  })
})
