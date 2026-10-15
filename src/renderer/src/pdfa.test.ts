import { existsSync, readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { convertToPdfA, substitute } from './pdfa'
import { checkStandards } from './standards'

const ARIAL = 'C:/Windows/Fonts/arial.ttf'
const have = existsSync(ARIAL)

async function make(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Minutes of meeting')
  doc.setAuthor('A. Writer')
  const page = doc.addPage([300, 300])
  page.drawText('Quarter end results', { x: 40, y: 200, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) })
  return doc.save()
}

describe('substitute', () => {
  it('maps the standard 14 to their metric twins and keeps the style', () => {
    expect(substitute('Helvetica-BoldOblique')).toEqual({ family: 'Arial', bold: true, italic: true })
    expect(substitute('Times-Roman')).toEqual({ family: 'Times New Roman', bold: false, italic: false })
    expect(substitute('ABCDEF+CourierNewPS-BoldMT')).toEqual({ family: 'Courier New', bold: true, italic: false })
    expect(substitute('ABCDEF+Calibri').family).toBe('Calibri')
  })
})

describe.skipIf(!have)('convertToPdfA', () => {
  it('identifies the file, adds the output intent, embeds the font and passes the basic checks', async () => {
    const before = await checkStandards(await make())
    expect(before.checks.find((c) => c.label === 'Embeds every font')?.status).toBe('fail')

    const out = await convertToPdfA(await make(), async () => new Uint8Array(readFileSync(ARIAL)))
    expect(out.report.fixed.join(' ')).toContain('Embedded 1 font')
    const after = await checkStandards(out.bytes)
    expect(after.claims.pdfa).toEqual({ part: 2, conformance: 'B' })
    const status = (l: string) => after.checks.find((c) => c.label === l)?.status
    expect(status('Embeds every font')).toBe('pass')
    expect(status('Has a PDF/A output intent (colour profile)')).toBe('pass')
    expect(status('Has XMP metadata')).toBe('pass')
    expect(status('Has no JavaScript')).toBe('pass')
    // Still a readable PDF with its text and title.
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getTitle()).toBe('Minutes of meeting')
    expect(doc.getPageCount()).toBe(1)
  })

  it('reports fonts it cannot embed instead of claiming success', async () => {
    const out = await convertToPdfA(await make(), async () => null)
    expect(out.report.remaining.join(' ')).toContain('could not be embedded')
    expect((await checkStandards(out.bytes)).checks.find((c) => c.label === 'Embeds every font')?.status).toBe('fail')
  })
})
