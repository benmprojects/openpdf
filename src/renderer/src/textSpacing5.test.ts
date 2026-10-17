import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { parseContent } from './content'
import { pageContent } from './pageContent'
import { alignedStart, formatIsEmpty, replaceBlock, spacedWidth, spacingOf, type BlockTarget, type TextStyle } from './textEdit'

const style: TextStyle = { font: 'Helvetica', flags: 32, weight: 0, italic: false, size: 12, color: '#000000', matrix: [1, 0, 0, 1, 50, 200] }
const target: BlockTarget = { page: 0, ordinals: [0], total: 1, origins: [{ x: 50, y: 200 }] }
const layout = { firstX: 50, restX: 50, baselineY: 200, leading: 0, width: 200 }

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([300, 300]).drawText('Old text here', { x: 50, y: 200, size: 12, font })
  return doc.save()
}

/** The last text matrix and spacing operators written to the page. */
async function lastText(bytes: Uint8Array) {
  const ops = parseContent(pageContent((await PDFDocument.load(bytes)).getPage(0)))
  const num = (op: string) => ops.filter((o) => o.op === op).map((o) => o.operands.filter((t) => t.t === 'num').map((t) => (t as { v: number }).v))
  const tm = num('Tm').at(-1)!
  return { x: tm[4], y: tm[5], tc: num('Tc').at(-1)?.[0], tw: num('Tw').at(-1)?.[0], tz: num('Tz').at(-1)?.[0] }
}

describe('spacing helpers', () => {
  it('measures with character spacing, word spacing and scale', () => {
    // 6 characters, 1 space: (60 glyph + 0.5 x 6 + 2 x 1) x 90 % = 58.5.
    expect(spacedWidth(60, 'ab cde', { tc: 0.5, tw: 2, hs: 90 })).toBeCloseTo(58.5)
  })
  it('aligns inside an area and justifies by word spacing', () => {
    const sp = { tc: 0, tw: 0, hs: 100 }
    const region = { x0: 50, span: 200 }
    expect(alignedStart('right', 'x', 80, region, 50, true, sp, 80).x).toBe(170)
    expect(alignedStart('centre', 'x', 80, region, 50, true, sp, 80).x).toBe(110)
    const j = alignedStart('justify', 'aa bb cc', 150, region, 50, false, sp, 150)
    expect(j.tw).toBeCloseTo(25)
    expect(alignedStart('justify', 'aa bb cc', 150, region, 50, true, sp, 150).tw).toBe(0)
  })
  it('counts spacing and alignment as a format', () => {
    expect(formatIsEmpty({})).toBe(true)
    expect(formatIsEmpty({ charSpacing: 1 })).toBe(false)
    expect(formatIsEmpty({ align: 'left' })).toBe(true)
    expect(spacingOf({ horizontalScale: 120 }).custom).toBe(true)
  })
})

describe('replaceBlock with spacing and alignment', () => {
  it('writes Tc, Tw and Tz for the new text', async () => {
    const r = await replaceBlock(await sample(), target, 'New text', style, null, null, { charSpacing: 1.5, wordSpacing: 4, horizontalScale: 110 }, 'Old text here')
    const t = await lastText(r.bytes)
    expect(t).toMatchObject({ x: 50, y: 200, tc: 1.5, tw: 4, tz: 110 })
  })
  it('right-aligns inside the original area', async () => {
    const r = await replaceBlock(await sample(), target, 'Right', style, null, layout, { align: 'right' }, 'Old text here')
    const t = await lastText(r.bytes)
    const w = (await (async () => {
      const doc = await PDFDocument.create()
      return (await doc.embedFont(StandardFonts.Helvetica)).widthOfTextAtSize('Right', 12)
    })())
    expect(t.x).toBeCloseTo(250 - w, 1)
  })
  it('centres, and leaves left-aligned text where it was', async () => {
    const c = await lastText((await replaceBlock(await sample(), target, 'Mid', style, null, layout, { align: 'centre' }, 'Old text here')).bytes)
    expect(c.x).toBeGreaterThan(100)
    expect(c.x).toBeLessThan(160)
    const l = await lastText((await replaceBlock(await sample(), target, 'Left', style, null, layout, { align: 'left', charSpacing: 1 }, 'Old text here')).bytes)
    expect(l.x).toBe(50)
  })
})
