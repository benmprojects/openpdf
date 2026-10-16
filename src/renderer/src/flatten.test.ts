import { PDFArray, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { applyFilter } from './commentFilter'
import { appearanceMatrix, flattenDocument } from './flatten'

describe('appearanceMatrix', () => {
  it('maps the box onto the rectangle', () => {
    expect(appearanceMatrix([0, 0, 10, 10], [1, 0, 0, 1, 0, 0], [100, 200, 120, 230])).toEqual([2, 0, 0, 3, 100, 200])
  })
})

async function twoPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const form = doc.getForm()
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([200, 200])
    const f = form.createTextField(`f${i}`)
    f.setText(`v${i}`)
    f.addToPage(page, { x: 10, y: 10, width: 100, height: 20 })
  }
  return doc.save()
}

describe('flattenDocument', () => {
  it('flattens form fields on the chosen pages only', async () => {
    const r = await flattenDocument(await twoPages(), 'fields', [0])
    expect(r.fields).toBe(1)
    const doc = await PDFDocument.load(r.bytes)
    expect(doc.getForm().getFields().map((f) => f.getName())).toEqual(['f1'])
    expect(doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0)
    expect(doc.getPage(1).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size()).toBe(1)
  })
  it('draws an annotation from its appearance and removes it', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    const ap = doc.context.stream('0 0 10 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] })
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [20, 20, 60, 60], F: 4, AP: { N: doc.context.register(ap) } })
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]))
    const r = await flattenDocument(await doc.save(), 'annots', [0])
    expect(r.annots).toBe(1)
    const out = await PDFDocument.load(r.bytes)
    expect(out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size()).toBe(0)
  })
  it('leaves a document with nothing to flatten unchanged', async () => {
    const plain = await (await PDFDocument.create()).save()
    const r = await flattenDocument(plain, 'both', [0])
    expect(r.bytes).toBe(plain)
  })
})

describe('applyFilter', () => {
  const list = [
    { page: 0, kind: 'note' as const, author: 'Ann' },
    { page: 1, kind: 'highlight' as const, author: 'Bob' },
    { page: 1, kind: 'note' as const }
  ]
  it('filters by page, type and author', () => {
    expect(applyFilter(list, { by: 'pages', pages: [1], kinds: [], authors: [] })).toHaveLength(2)
    expect(applyFilter(list, { by: 'type', pages: [], kinds: ['note'], authors: [] })).toHaveLength(2)
    expect(applyFilter(list, { by: 'author', pages: [], kinds: [], authors: ['bob'] })).toHaveLength(1)
    expect(applyFilter(list, { by: 'author', pages: [], kinds: [], authors: [''] })).toHaveLength(1)
  })
})
