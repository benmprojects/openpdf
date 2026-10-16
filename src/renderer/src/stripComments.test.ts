import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { stripComments } from './stripComments'

describe('stripComments', () => {
  it('removes markup but keeps form fields and links', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    const make = (subtype: string) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: subtype, Rect: [0, 0, 10, 10] }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([make('Text'), make('Widget'), make('Highlight'), make('Link')]))
    const out = await PDFDocument.load(await stripComments(await doc.save()))
    const annots = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray)
    const subtypes = annots.asArray().map((r) => (out.context.lookup(r, PDFDict).get(PDFName.of('Subtype')) as PDFName).decodeText())
    expect(subtypes).toEqual(['Widget', 'Link'])
  })
  it('drops the list when nothing is left', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Ink' }))]))
    const out = await PDFDocument.load(await stripComments(await doc.save()))
    expect(out.getPage(0).node.has(PDFName.of('Annots'))).toBe(false)
  })
})
