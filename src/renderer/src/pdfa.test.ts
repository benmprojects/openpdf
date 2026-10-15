import { existsSync, readFileSync } from 'node:fs'
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
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

describe('structural fixes', () => {
  const none = async () => null

  it('gives a page the resources it would have inherited, and names a layer configuration', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    const ctx = doc.context
    // Move the page's resources up to the page tree, so the page inherits them.
    const res = page.node.get(PDFName.of('Resources'))!
    page.node.delete(PDFName.of('Resources'))
    doc.catalog.lookup(PDFName.of('Pages'), PDFDict).set(PDFName.of('Resources'), res)
    doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [], D: { Order: [], AS: [] } }))
    const out = await convertToPdfA(await doc.save(), none)
    const back = await PDFDocument.load(out.bytes)
    expect(back.getPage(0).node.has(PDFName.of('Resources'))).toBe(true)
    const d = back.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('D'), PDFDict)
    expect(d.has(PDFName.of('Name'))).toBe(true)
    expect(d.has(PDFName.of('AS'))).toBe(false)
    expect(out.report.fixed.join(' ')).toContain('own resources')
  })

  it('adds a glyph map to TrueType CID fonts', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    const ctx = doc.context
    const cid = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'Test', FontDescriptor: ctx.register(ctx.obj({ Type: 'FontDescriptor', FontFile2: ctx.register(ctx.flateStream(new Uint8Array(4))) })) }))
    const type0 = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'Test', Encoding: 'Identity-H', DescendantFonts: [cid] }))
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F9: type0 } }))
    const out = await convertToPdfA(await doc.save(), none)
    const back = await PDFDocument.load(out.bytes)
    const f = (back.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict).lookup(PDFName.of('F9'), PDFDict).lookup(PDFName.of('DescendantFonts')) as unknown as { lookup(i: number): PDFDict }).lookup(0)
    expect(f.lookup(PDFName.of('CIDToGIDMap'))).toBe(PDFName.of('Identity'))
  })
})
