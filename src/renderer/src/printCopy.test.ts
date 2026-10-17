import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { printCopy } from './printCopy'

async function sample() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  page.drawText('Body text', { x: 20, y: 100 })
  const make = (subtype: string, f?: number) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: subtype, Rect: [0, 0, 10, 10], ...(f === undefined ? {} : { F: f }) }))
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([make('Text', 4), make('Highlight', 4), make('Ink', 0), make('Square', 4 | 2), make('Widget'), make('Widget', 0), make('Link'), make('Stamp', 4 | 128)])
  )
  return doc.save()
}

async function subtypes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  return annots ? annots.asArray().map((r) => (doc.context.lookup(r, PDFDict).get(PDFName.of('Subtype')) as PDFName).decodeText()) : []
}

describe('printCopy', () => {
  it('document and comments: leaves out comments that do not print or are hidden, keeps the rest', async () => {
    // Ink has no Print flag, Square is hidden, the second Widget has flags 0 explicitly; the first Widget has no /F at all.
    expect(await subtypes(await printCopy(await sample(), 'comments'))).toEqual(['Text', 'Highlight', 'Widget', 'Link', 'Stamp'])
  })
  it('document: only form fields and links remain', async () => {
    expect(await subtypes(await printCopy(await sample(), 'document'))).toEqual(['Widget', 'Link'])
  })
  it('comments only: no page content, no form fields or links', async () => {
    const out = await printCopy(await sample(), 'markup')
    expect(await subtypes(out)).toEqual(['Text', 'Highlight', 'Stamp'])
    const doc = await PDFDocument.load(out)
    const contents = doc.getPage(0).node.lookup(PDFName.of('Contents'))
    expect((contents as PDFRawStream).getContents().length).toBe(0)
  })
  it('drops the list when nothing is left, and does not change its input', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100]).node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Ink', Rect: [0, 0, 1, 1], F: 0 }))]))
    const input = await doc.save()
    const before = input.slice()
    const out = await PDFDocument.load(await printCopy(input, 'comments'))
    expect(out.getPage(0).node.has(PDFName.of('Annots'))).toBe(false)
    expect(input).toEqual(before)
  })
})
