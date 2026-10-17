import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { applySubset, DEFAULT_KEEP, insertWithOptions, prepareInserted } from './insertOptions'
import { readOutlineTree } from './outlineRead'
import { writeOutline } from './outlineEdit'

async function plain(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]).drawText(`P${i + 1}`)
  return doc.save()
}

/** A two-page file: a text field and a highlight on page 1, bookmarks to both pages. */
async function source(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  doc.addPage([200, 200])
  const field = doc.getForm().createTextField('Name')
  field.addToPage(doc.getPage(0), { x: 10, y: 10, width: 100, height: 20 })
  field.setText('Alex')
  const note = doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], Contents: PDFString.of('note'), F: 4 })
  doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([...(doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray()), doc.context.register(note)]))
  return writeOutline(await doc.save(), [{ title: 'First', page: 0, children: [] }, { title: 'Second', page: 1, children: [] }])
}

const subtypes = async (bytes: Uint8Array, page: number) => {
  const doc = await PDFDocument.load(bytes)
  const a = doc.getPage(page).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  return Array.from({ length: a?.size() ?? 0 }, (_, i) => a!.lookupMaybe(i, PDFDict)?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText())
}

describe('applySubset', () => {
  it('narrows a source range to odd or even page numbers', () => {
    expect(applySubset(null, 6, 'odd')).toEqual([0, 2, 4])
    expect(applySubset(null, 6, 'even')).toEqual([1, 3, 5])
    expect(applySubset([1, 2, 3, 4], 6, 'odd')).toEqual([2, 4])
    expect(applySubset([1, 2], 6, 'all')).toEqual([1, 2])
    expect(applySubset(null, 6, 'all')).toBeNull()
  })
})

describe('insertWithOptions', () => {
  it('keeps comments and joins fields to the form (renamed when the name is taken)', async () => {
    const dest = await source()
    const r = await insertWithOptions(dest, 1, [{ data: await source(), pages: [0] }], { ...DEFAULT_KEEP })
    expect(r.count).toBe(1)
    const doc = await PDFDocument.load(r.bytes)
    expect(doc.getPageCount()).toBe(3)
    expect((await subtypes(r.bytes, 1)).sort()).toEqual(['Text', 'Widget'])
    const names = doc.getForm().getFields().map((f) => f.getName()).sort()
    expect(names).toEqual(['Name', 'Name_2'])
  })

  it('removes comments, or fields, when asked', async () => {
    const r = await insertWithOptions(await plain(2), 1, [{ data: await source(), pages: [0] }], { comments: 'remove', fields: 'keep', bookmarks: 'remove' })
    expect(await subtypes(r.bytes, 1)).toEqual(['Widget'])
    const r2 = await insertWithOptions(await plain(2), 1, [{ data: await source(), pages: [0] }], { comments: 'keep', fields: 'remove', bookmarks: 'remove' })
    expect(await subtypes(r2.bytes, 1)).toEqual(['Text'])
    expect((await PDFDocument.load(r2.bytes)).getForm().getFields()).toHaveLength(0)
  })

  it('flattens the fields into the page', async () => {
    const r = await insertWithOptions(await plain(1), 1, [{ data: await source(), pages: [0] }], { comments: 'keep', fields: 'flatten', bookmarks: 'remove' })
    expect(await subtypes(r.bytes, 1)).toEqual(['Text'])
  })

  it('brings the source bookmarks for the inserted pages and shifts the existing ones', async () => {
    const dest = await writeOutline(await plain(3), [{ title: 'Intro', page: 0, children: [] }, { title: 'End', page: 2, children: [] }])
    const r = await insertWithOptions(dest, 1, [{ data: await source(), pages: [1] }], { comments: 'keep', fields: 'keep', bookmarks: 'keep' })
    const tree = await readOutlineTree(r.bytes)
    expect(tree.map((n) => [n.title, n.page])).toEqual([['Intro', 0], ['Second', 1], ['End', 3]])
  })

  it('leaves the bookmarks alone when they are not wanted', async () => {
    const dest = await writeOutline(await plain(3), [{ title: 'End', page: 2, children: [] }])
    const r = await insertWithOptions(dest, 0, [{ data: await source(), pages: null }], DEFAULT_KEEP)
    expect((await readOutlineTree(r.bytes)).map((n) => [n.title, n.page])).toEqual([['End', 4]]) // still End: the pages moved down by the two inserted
  })
})

describe('prepareInserted', () => {
  it('gives a form its default font', async () => {
    const out = await prepareInserted(await source(), 0, 2, { comments: 'keep', fields: 'keep' })
    const doc = await PDFDocument.load(out)
    const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)!
    expect(form.has(PDFName.of('DA'))).toBe(true)
    expect(form.lookupMaybe(PDFName.of('DR'), PDFDict)?.has(PDFName.of('Font'))).toBe(true)
  })
})
