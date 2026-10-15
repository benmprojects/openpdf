import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { OcrLine } from '../../main/ocr'
import { addTextLayer, baselineAt, fontsForLanguages } from './ocrLayer'
import { pageContent } from './pageContent'

const line = (text: string, x0: number, y0: number, x1: number, y1: number, baseline = { x0, y0: y1 - 4, x1, y1: y1 - 4 }): OcrLine => ({ words: [{ text, x0, y0, x1, y1, confidence: 95 }], baseline })

async function blank(rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const p = doc.addPage([300, 200])
  if (rotate) p.setRotation({ type: 'degrees', angle: rotate } as never)
  return doc.save({ useObjectStreams: false })
}

describe('baselineAt', () => {
  it('follows a sloping baseline and falls back when there is none', () => {
    const l = line('a', 0, 0, 100, 20, { x0: 0, y0: 10, x1: 100, y1: 20 })
    expect(baselineAt(l, 50, 99)).toBe(15)
    expect(baselineAt(line('a', 0, 0, 10, 10, { x0: 0, y0: 0, x1: 0, y1: 0 }), 5, 99)).toBe(99)
  })
})

describe('fontsForLanguages', () => {
  it('names fonts for non-Latin scripts only', () => {
    expect(fontsForLanguages(['eng', 'fra'])).toEqual([])
    expect(fontsForLanguages(['rus', 'ukr'])).toEqual(['Arial'])
    expect(fontsForLanguages(['jpn'])[0]).toBe('Yu Gothic')
  })
})

describe('addTextLayer', () => {
  it('writes invisible text at the word position, scaled to the word box', async () => {
    // A 600 x 400 pixel image of a 300 x 200 point page (2 px per point): a word 100 px wide and 20 px tall.
    const out = await addTextLayer(await blank(), [{ page: 0, scale: 2, lines: [line('Hello', 40, 60, 140, 80)] }])
    expect(out.words).toBe(1)
    const raw = pageContent((await PDFDocument.load(out.bytes)).getPage(0))
    expect(raw).toContain('3 Tr')
    expect(raw).toContain('Tz')
    // Origin: x = 40 / 2 = 20 points; baseline y = (80 - 4) / 2 = 38 down from the top, so 200 - 38 = 162 up from the bottom.
    expect(raw).toMatch(/1 0 0 1 20 162 Tm/)
    expect(raw).toContain('<48656C6C6F> Tj')
  })

  it('keeps the text upright on a rotated page', async () => {
    const out = await addTextLayer(await blank(90), [{ page: 0, scale: 1, lines: [line('Turned', 10, 10, 60, 24)] }])
    const raw = pageContent((await PDFDocument.load(out.bytes)).getPage(0))
    // For a page turned 90 degrees the text direction in page space is along y.
    expect(raw).toMatch(/0 1 -1 0 [\d.]+ [\d.]+ Tm/)
  })

  it('skips words the font cannot show at all', async () => {
    const out = await addTextLayer(await blank(), [{ page: 0, scale: 1, lines: [line('中文', 10, 10, 60, 24), line('ok', 10, 40, 40, 54)] }])
    expect(out).toMatchObject({ words: 1, skipped: 1 })
  })
})
