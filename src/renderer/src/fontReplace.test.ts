import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { listDocumentFonts, replaceFonts, replaceProblem, suggestTarget } from './fontReplace'

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const a = await doc.embedFont(StandardFonts.Helvetica)
  const b = await doc.embedFont(StandardFonts.TimesRoman)
  const page = doc.addPage([200, 100])
  page.drawText('one', { font: a, x: 10, y: 50 })
  page.drawText('two', { font: b, x: 10, y: 20 })
  return doc.save()
}

describe('listDocumentFonts', () => {
  it('lists each font once with whether it can be replaced', async () => {
    const fonts = await listDocumentFonts(await sample())
    expect(fonts.map((f) => f.name)).toEqual(['Helvetica', 'Times-Roman'])
    expect(fonts.every((f) => f.replaceable && !f.embedded)).toBe(true)
  })
})

describe('replaceFonts', () => {
  it('switches a font to a standard one everywhere', async () => {
    const r = await replaceFonts(await sample(), [{ from: 'Helvetica', to: { kind: 'standard', family: 'courier', bold: true, italic: false } }], async () => null)
    expect(r.replaced).toBe(1)
    const after = await listDocumentFonts(r.bytes)
    expect(after.map((f) => f.name).sort()).toEqual(['Courier-Bold', 'Times-Roman'])
    // The page still draws with the same resource name.
    const doc = await PDFDocument.load(r.bytes)
    const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
    expect(fonts.keys()).toHaveLength(2)
  })
  it('says when no installed font was found and leaves the font as it was', async () => {
    const r = await replaceFonts(await sample(), [{ from: 'Times-Roman', to: { kind: 'installed', family: 'Nowhere', bold: false, italic: false } }], async () => null)
    expect(r.replaced).toBe(0)
    expect(r.missing).toEqual(['Times-Roman'])
  })
  it('refuses fonts with their own codes', async () => {
    const doc = await PDFDocument.create()
    const f = doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Custom', Encoding: { Differences: [1, 'a'] } }) as PDFDict
    expect(replaceProblem(f)).toMatch(/custom encoding/)
    const cid = doc.context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'X' }) as PDFDict
    expect(replaceProblem(cid)).toMatch(/CID/)
  })
})

describe('suggestTarget', () => {
  it('suggests the metric twin', () => {
    expect(suggestTarget('Helvetica-Bold')).toEqual({ kind: 'installed', family: 'Arial', bold: true, italic: false })
    expect(suggestTarget('TimesNewRomanPS-ItalicMT')).toMatchObject({ family: 'Times New Roman', italic: true })
    expect(suggestTarget('Calibri').kind).toBe('standard')
  })
})
