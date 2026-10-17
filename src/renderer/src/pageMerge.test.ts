import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { joinedSize, joinPages, planJoin } from './pageMerge'

async function halves(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const sizes: [number, number][] = [[300, 600], [300, 600], [200, 400], [250, 500], [100, 100]]
  sizes.forEach(([w, h], i) => doc.addPage([w, h]).drawText(`Half ${i + 1}`, { x: 20, y: 20, size: 14, font }))
  return doc.save()
}

describe('planJoin', () => {
  it('pairs the chosen pages in order and leaves an odd one out', () => {
    expect(planJoin([3, 0, 1, 2, 4])).toEqual({ pairs: [[0, 1], [2, 3]], left: 4 })
    expect(planJoin([2, 5])).toEqual({ pairs: [[2, 5]], left: null })
    expect(planJoin([1]).pairs).toEqual([])
  })
})

describe('joinedSize', () => {
  it('adds along the joined direction and takes the larger across', () => {
    expect(joinedSize({ w: 300, h: 600 }, { w: 200, h: 400 }, 'side')).toEqual({ w: 500, h: 600 })
    expect(joinedSize({ w: 300, h: 600 }, { w: 200, h: 400 }, 'stack')).toEqual({ w: 300, h: 1000 })
  })
})

describe('joinPages', () => {
  it('joins two half pages side by side into the first page', async () => {
    const r = await joinPages(await halves(), [0, 1], 'side')
    expect(r.joined).toBe(1)
    const out = await PDFDocument.load(r.bytes)
    expect(out.getPageCount()).toBe(4)
    expect(out.getPage(0).getSize()).toEqual({ width: 600, height: 600 })
    expect(out.getPage(1).getSize()).toEqual({ width: 200, height: 400 })
  })

  it('stacks pairs and keeps pages that are not chosen', async () => {
    const r = await joinPages(await halves(), [0, 1, 2, 3], 'stack')
    const out = await PDFDocument.load(r.bytes)
    expect(out.getPageCount()).toBe(3)
    expect(out.getPage(0).getSize()).toEqual({ width: 300, height: 1200 })
    expect(out.getPage(1).getSize()).toEqual({ width: 250, height: 900 })
    expect(out.getPage(2).getSize()).toEqual({ width: 100, height: 100 })
  })

  it('asks for at least two pages', async () => {
    await expect(joinPages(await halves(), [2], 'side')).rejects.toThrow(/at least two/)
  })
})

describe('joinPages content', () => {
  it('keeps the content of both pages, including the one rewritten in place', async () => {
    const out = await PDFDocument.load((await joinPages(await halves(), [0, 1], 'side')).bytes)
    let forms = ''
    for (const [, obj] of out.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Form') forms += new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode())
    }
    // Both halves still have their text: shown as hex strings under a font.
    expect((forms.match(/ Tj/g) ?? []).length).toBe(2)
  })
})
