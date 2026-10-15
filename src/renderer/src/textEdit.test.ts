import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { bytesToString, isShow, parseContent, showBytes, showOrigins } from './content'
import { existsSync, readFileSync } from 'node:fs'
import { embeddable, pickStandardFont, removalKeepsLayout, replaceText, type TextStyle } from './textEdit'

/** Style of the i-th line made by makePdf (lines sit at x 20, y 250, 230, 210). */
const at = (i: number): TextStyle => ({ font: 'Helvetica', flags: 32, weight: 0, italic: false, size: 12, color: '#336699', matrix: [1, 0, 0, 1, 20, 250 - i * 20] })
const style = at(0)

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const [i, t] of ['alpha', 'beta', 'gamma'].entries()) page.drawText(t, { x: 20, y: 250 - i * 20, size: 12, font })
  return doc.save()
}

async function shows(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const c = doc.getPage(0).node.lookup(PDFName.of('Contents'))
  const parts = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i)) : [c]
  const src = parts.map((p) => (p instanceof PDFRawStream ? bytesToString(decodePDFRawStream(p).decode()) : '')).join('\n')
  return parseContent(src).filter(isShow).map(showBytes)
}

describe('removalKeepsLayout', () => {
  it('is false when the next show runs on from this one, true when it is repositioned', () => {
    const run = parseContent('BT /F1 12 Tf 10 10 Td (a) Tj (b) Tj ET')
    expect(removalKeepsLayout(run, run.findIndex(isShow))).toBe(false)
    const moved = parseContent('BT 10 10 Td (a) Tj 0 -14 Td (b) Tj ET')
    expect(removalKeepsLayout(moved, moved.findIndex(isShow))).toBe(true)
    const last = parseContent('BT 10 10 Td (a) Tj ET')
    expect(removalKeepsLayout(last, last.findIndex(isShow))).toBe(true)
    const newline = parseContent("BT 10 10 Td (a) Tj (b) ' ET")
    expect(removalKeepsLayout(newline, newline.findIndex(isShow))).toBe(true)
  })
})

describe('pickStandardFont', () => {
  it('matches family, weight and slant from the name and descriptor', () => {
    expect(pickStandardFont({ font: 'ArialMT', flags: 32, weight: 0, italic: false })).toBe(StandardFonts.Helvetica)
    expect(pickStandardFont({ font: 'Arial-BoldItalicMT', flags: 32, weight: 0, italic: false })).toBe(StandardFonts.HelveticaBoldOblique)
    expect(pickStandardFont({ font: 'TimesNewRomanPS-BoldMT', flags: 34, weight: 700, italic: false })).toBe(StandardFonts.TimesRomanBold)
    expect(pickStandardFont({ font: 'CourierNewPSMT', flags: 33, weight: 0, italic: false })).toBe(StandardFonts.Courier)
    expect(pickStandardFont({ font: 'Calibri', flags: 32, weight: 0, italic: true })).toBe(StandardFonts.HelveticaOblique)
    expect(pickStandardFont({ font: 'ABCDEF+Unknown', flags: 34, weight: 0, italic: false })).toBe(StandardFonts.TimesRoman)
  })
})

describe('replaceText', () => {
  it('swaps one text object for new text and leaves the others', async () => {
    const out = await replaceText(await makePdf(), { page: 0, ordinal: 1, total: 3 }, 'BETA two', at(1))
    expect(out.hiddenOriginal).toBe(false)
    expect(await shows(out.bytes)).toEqual(['alpha', 'gamma', 'BETA two'])
  })

  it('deletes a text object when the new text is empty', async () => {
    const out = await replaceText(await makePdf(), { page: 0, ordinal: 0, total: 3 }, '', style)
    expect(await shows(out.bytes)).toEqual(['beta', 'gamma'])
  })

  it('refuses when the operator is not where PDFium says the object is', async () => {
    await expect(replaceText(await makePdf(), { page: 0, ordinal: 1, total: 3 }, 'x', at(2))).rejects.toThrow(/page changed/)
  })

  it('refuses when the page does not have the expected number of text objects', async () => {
    await expect(replaceText(await makePdf(), { page: 0, ordinal: 0, total: 4 }, 'x', style)).rejects.toThrow(/cannot be edited safely/)
  })

  it('refuses characters the substitute font cannot show', async () => {
    await expect(replaceText(await makePdf(), { page: 0, ordinal: 0, total: 3 }, '日本語', style)).rejects.toThrow(/cannot show/)
  })
})

describe('showOrigins', () => {
  it('follows Tm, Td, T*, cm and q/Q, and says null for text that runs on', () => {
    const ops = parseContent("q 2 0 0 2 10 20 cm BT 1 0 0 1 5 6 Tm (a) Tj (b) Tj 14 TL T* (c) Tj 3 4 Td (d) Tj ET Q BT 7 8 Td (e) Tj ET")
    const o = showOrigins(ops)
    expect(o[0]).toEqual({ x: 20, y: 32 })
    expect(o[1]).toBeNull()
    expect(o[2]).toEqual({ x: 20, y: 32 - 28 })
    expect(o[3]).toEqual({ x: 26, y: 32 - 28 + 8 })
    expect(o[4]).toEqual({ x: 7, y: 8 })
  })
})

const ARIAL = 'C:/Windows/Fonts/arial.ttf'
describe.skipIf(!existsSync(ARIAL))('installed fonts', () => {
  it('embeds an installed font when it has every character, and says so', async () => {
    const font = new Uint8Array(readFileSync(ARIAL))
    expect(embeddable(font, 'Plans and specs 2026')).toBe(true)
    expect(embeddable(font, '日本語')).toBe(false)
    const out = await replaceText(await makePdf(), { page: 0, ordinal: 1, total: 3 }, 'Beta in Arial', at(1), font)
    expect(out.fontUsed).toBe('installed')
    expect((await shows(out.bytes)).length).toBe(3)
  })

  it('falls back to a standard font when the installed one lacks a character', async () => {
    const font = new Uint8Array(readFileSync(ARIAL))
    const out = await replaceText(await makePdf(), { page: 0, ordinal: 1, total: 3 }, 'Beta → next', at(1), font)
    expect(out.fontUsed).toBe(embeddable(font, '→') ? 'installed' : 'standard')
  })
})
