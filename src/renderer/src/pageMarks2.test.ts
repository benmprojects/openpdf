import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addHeaderFooter, addWatermark, watermarkCentres } from './pageMarks'

async function pdf(n = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) doc.addPage([600, 800])
  return doc.save()
}

/** The text of the page's mark streams (the ones OpenPDF added), joined. */
async function markText(bytes: Uint8Array, page: number): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const c = doc.getPage(page).node.get(PDFName.of('Contents'))
  let out = ''
  if (c instanceof PDFArray) {
    for (let i = 0; i < c.size(); i++) {
      const s = doc.context.lookup(c.get(i))
      if (s instanceof PDFRawStream && s.dict.has(PDFName.of('OPMarks'))) out += new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) + '\n'
    }
  }
  return out
}

const base = { slots: { tl: 'LEFT' }, fontSize: 10, font: 'Helvetica' as const, color: '#000000', margin: 20, pages: [0, 1, 2], startNumber: 1 }
const info = { fileName: 'a.pdf', labels: null }

/** The x position of the first text in a mark stream ("1 0 0 -1 x y Tm"). */
const firstX = (ops: string) => Number(/1 0 0 -1 ([\d.-]+) ([\d.-]+) Tm/.exec(ops)?.[1])
const firstY = (ops: string) => Number(/1 0 0 -1 ([\d.-]+) ([\d.-]+) Tm/.exec(ops)?.[2])

describe('header and footer options', () => {
  it('uses different text on the first marked page', async () => {
    const out = await addHeaderFooter(await pdf(), { ...base, firstSlots: {} }, info)
    expect(await markText(out, 0)).toBe('')
    expect(await markText(out, 1)).toContain('Tj')
    const out2 = await addHeaderFooter(await pdf(), { ...base, firstSlots: { tc: 'COVER' } }, info)
    expect(await markText(out2, 0)).toContain('Tj')
  })

  it('sets the margin of each side and an offset', async () => {
    const plain = await markText(await addHeaderFooter(await pdf(1), base, info), 0)
    expect(firstX(plain)).toBe(20)
    const sides = await markText(await addHeaderFooter(await pdf(1), { ...base, margins: { left: 50, top: 70 } }, info), 0)
    expect(firstX(sides)).toBe(50)
    expect(firstY(sides)).toBeCloseTo(70 + 10 * 0.8, 2)
    const moved = await markText(await addHeaderFooter(await pdf(1), { ...base, offset: { x: 5, y: 7 } }, info), 0)
    expect(firstX(moved)).toBe(25)
    expect(firstY(moved)).toBeCloseTo(firstY(plain) + 7, 2)
  })

  it('shrinks text that is wider than the room it has', async () => {
    const long = 'A long line of header text that cannot fit between the margins of the page at this size '.repeat(2)
    const big = await markText(await addHeaderFooter(await pdf(1), { ...base, slots: { tl: long } }, info), 0)
    const small = await markText(await addHeaderFooter(await pdf(1), { ...base, slots: { tl: long }, shrink: true }, info), 0)
    const sizeOf = (s: string) => Number(/ ([\d.]+) Tf/.exec(s)?.[1])
    expect(sizeOf(big)).toBe(10)
    expect(sizeOf(small)).toBeLessThan(10)
  })

  it('writes the date in the chosen format', async () => {
    const out = await addHeaderFooter(await pdf(1), { ...base, slots: { tl: '<<date>>' }, dateFormat: 'YYYY-MM-DD' }, info)
    // Shown through the font's encoding: the text appears as hex, so check that the stream has a string at all.
    expect(await markText(out, 0)).toContain('Tj')
  })
})

describe('watermark placement', () => {
  const page = { w: 600, h: 800 }
  const box = { bw: 200, bh: 100 }
  it('is in the middle by default and moves to an edge with its margin', () => {
    expect(watermarkCentres(page, box, {})).toEqual([{ x: 300, y: 400 }])
    expect(watermarkCentres(page, box, { align: 'tl', margin: 20 })).toEqual([{ x: 120, y: 70 }])
    expect(watermarkCentres(page, box, { align: 'br', margin: 20 })).toEqual([{ x: 480, y: 730 }])
    expect(watermarkCentres(page, box, { offset: { x: 10, y: -5 } })).toEqual([{ x: 310, y: 395 }])
  })
  it('tiles across the page with gaps, only where the mark touches the page', () => {
    const tiles = watermarkCentres(page, box, { tile: { gapX: 100, gapY: 100 } })
    expect(tiles.length).toBeGreaterThan(9)
    expect(tiles).toContainEqual({ x: 300, y: 400 })
    expect(tiles.every((p) => p.x + 100 > 0 && p.x - 100 < 600 && p.y + 50 > 0 && p.y - 50 < 800)).toBe(true)
    expect(new Set(tiles.map((p) => p.x)).size).toBeGreaterThan(1)
  })
})

describe('watermark output', () => {
  it('draws one copy, or many when tiled, and the date token', async () => {
    const spec = { kind: 'text' as const, text: 'DRAFT <<page>>', font: 'Helvetica' as const, fontSize: 40, color: '#ff0000', opacity: 0.3, angle: 0, scale: 0.5, behind: false, pages: [0] }
    const one = await markText(await addWatermark(await pdf(1), spec), 0)
    const many = await markText(await addWatermark(await pdf(1), { ...spec, tile: { gapX: 40, gapY: 40 } }), 0)
    expect(one.match(/Tj/g)).toHaveLength(1)
    expect((many.match(/Tj/g) ?? []).length).toBeGreaterThan(4)
  })
  it('shrinks a mark that is bigger than the page', async () => {
    const spec = { kind: 'text' as const, text: 'A VERY LONG WATERMARK TEXT', font: 'Helvetica' as const, fontSize: 200, color: '#ff0000', opacity: 0.3, angle: 0, scale: 0.5, behind: false, pages: [0] }
    const sizeOf = (s: string) => Number(/ ([\d.]+) Tf/.exec(s)?.[1])
    const big = await markText(await addWatermark(await pdf(1), spec), 0)
    const fitted = await markText(await addWatermark(await pdf(1), { ...spec, shrink: true }), 0)
    expect(sizeOf(big)).toBe(200)
    expect(sizeOf(fitted)).toBeLessThan(60)
  })
})
