import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { checkStandards, type StandardsReport } from './standards'

const status = (r: StandardsReport, label: string) => r.checks.find((c) => c.label === label)?.status

async function plain(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  page.drawText('Hello', { x: 50, y: 200, font: await doc.embedFont(StandardFonts.Helvetica) })
  return doc.save()
}

describe('checkStandards', () => {
  it('finds no claim in an ordinary file and fails the basics', async () => {
    const r = await checkStandards(await plain())
    expect(r.claims).toEqual({})
    expect(status(r, 'Declares its conformance in the XMP metadata')).toBe('fail')
    expect(status(r, 'Embeds every font')).toBe('fail')
    expect(r.checks.find((c) => c.label === 'Embeds every font')?.detail).toContain('Helvetica')
    expect(status(r, 'Has no JavaScript')).toBe('pass')
    expect(status(r, 'Is marked as a tagged PDF')).toBe('fail')
    expect(status(r, 'Sets the document language')).toBe('fail')
  })

  it('reads claims and tagging from a file that has them', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 300])
    doc.setTitle('Annual report')
    const ctx = doc.context
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" pdfaid:part="2" pdfaid:conformance="B" pdfuaid:part="1"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
    doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })))
    doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-AU'))
    doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }))
    doc.catalog.set(PDFName.of('ViewerPreferences'), ctx.obj({ DisplayDocTitle: true }))
    const fig1 = ctx.obj({ Type: 'StructElem', S: 'Figure', Alt: PDFString.of('A chart') })
    const fig2 = ctx.obj({ Type: 'StructElem', S: 'Figure' })
    doc.catalog.set(PDFName.of('StructTreeRoot'), ctx.obj({ Type: 'StructTreeRoot', K: [ctx.register(fig1), ctx.register(fig2)] }))
    const r = await checkStandards(await doc.save())
    expect(r.claims).toEqual({ pdfa: { part: 2, conformance: 'B' }, pdfua: { part: 1 } })
    expect(status(r, 'Declares its conformance in the XMP metadata')).toBe('pass')
    expect(status(r, 'Declares PDF/UA in the XMP metadata')).toBe('pass')
    expect(status(r, 'Is marked as a tagged PDF')).toBe('pass')
    expect(status(r, 'Has a structure tree (tags)')).toBe('pass')
    expect(status(r, 'Sets the document language')).toBe('pass')
    expect(status(r, 'Has a title, shown in the window title bar')).toBe('pass')
    expect(status(r, 'Figures have alternative text')).toBe('fail')
    expect(r.checks.find((c) => c.label === 'Figures have alternative text')?.detail).toBe('1 of 2 figures')
    expect(status(r, 'Has a PDF/A output intent (colour profile)')).toBe('fail')
    // PDF/A-2 may use transparency, so that check is not made.
    expect(r.checks.some((c) => c.label.startsWith('Uses no transparency'))).toBe(false)
  })
})
