import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { convertToPdfA, findTransparency, removeForbiddenAnnotations } from './pdfa'
import { checkPdfX, convertToPdfX } from './pdfx'
import { embedFiles } from './portfolio'
import { readXmp } from './metadata'

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([200, 100])
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(1, 0, 0), opacity: 0.5 })
  page.drawText('Print me', { x: 10, y: 80, size: 12, font, color: rgb(0, 0, 1) })
  return doc.save()
}

const noFont = async () => null
const head = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 8))

describe('convertToPdfX', () => {
  it('writes the X-1a identification, a CMYK-only page and a named print condition', async () => {
    const r = await convertToPdfX(await sample(), noFont, 'x1a', undefined, new Date(Date.UTC(2026, 0, 2)))
    expect(head(r.bytes)).toBe('%PDF-1.4')
    expect(r.report.target).toBe('PDF/X-1a:2003')
    const doc = await PDFDocument.load(r.bytes)
    const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray)
    expect(intents.lookup(0, PDFDict).lookup(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFX'))
    expect(doc.getPage(0).node.has(PDFName.of('TrimBox'))).toBe(true)
    expect(await readXmp(r.bytes)).toContain('PDF/X-1a:2003')
    const checks = await checkPdfX(r.bytes, 'x1a')
    const by = (l: string) => checks.find((c) => c.label.startsWith(l))!
    expect(by('Only CMYK').status).toBe('pass')
    expect(by('No transparency').status).toBe('pass')
    expect(by('Identified').status).toBe('pass')
    expect(by('Has a PDF/X output intent').status).toBe('pass')
    expect(by('Trapping').status).toBe('pass')
    // The test font finder finds nothing, so the standard font stays unembedded: said plainly, not hidden.
    expect(by('Every font is embedded').status).toBe('fail')
    expect(r.report.remaining.some((x) => /Fonts that could not be embedded/.test(x))).toBe(true)
  })
  it('writes X-4 with an ICC output intent and keeps transparency', async () => {
    const r = await convertToPdfX(await sample(), noFont, 'x4')
    expect(head(r.bytes)).toBe('%PDF-1.6')
    const doc = await PDFDocument.load(r.bytes)
    const intent = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict)
    expect(intent.has(PDFName.of('DestOutputProfile'))).toBe(true)
    expect(findTransparency(doc).states).toBe(1)
  })
  it('fails the checks on an ordinary file', async () => {
    const checks = await checkPdfX(await sample(), 'x4')
    expect(checks.filter((c) => c.status === 'fail').length).toBeGreaterThan(3)
  })
})

describe('PDF/A parts', () => {
  it('A-1b is PDF 1.4 without object streams, with plain transparency settings', async () => {
    const r = await convertToPdfA(await sample(), noFont, new Date(), 1)
    expect(head(r.bytes)).toBe('%PDF-1.4')
    expect(await readXmp(r.bytes)).toContain('<pdfaid:part>1</pdfaid:part>')
    expect(findTransparency(await PDFDocument.load(r.bytes)).states).toBe(0)
    expect(r.report.target).toBe('PDF/A-1b')
  })
  it('A-3b keeps attached files and describes them', async () => {
    const withFile = await embedFiles(await sample(), [{ name: 'data.csv', data: new TextEncoder().encode('a,b'), modified: new Date() }])
    const r = await convertToPdfA(withFile, noFont, new Date(), 3)
    const doc = await PDFDocument.load(r.bytes)
    const af = doc.catalog.lookup(PDFName.of('AF'), PDFArray)
    expect(af.size()).toBe(1)
    expect(af.lookup(0, PDFDict).lookup(PDFName.of('AFRelationship'))).toBe(PDFName.of('Unspecified'))
    const two = await convertToPdfA(withFile, noFont, new Date(), 2)
    expect((await PDFDocument.load(two.bytes)).catalog.has(PDFName.of('AF'))).toBe(false)
  })
  it('removes annotation kinds a part does not allow', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([100, 100])
    const mk = (sub: string) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: sub, Rect: [0, 0, 10, 10] }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([mk('Text'), mk('Caret'), mk('Sound')]))
    expect(removeForbiddenAnnotations(doc, 2)).toBe(1)
    expect(removeForbiddenAnnotations(doc, 1)).toBe(1)
  })
})
