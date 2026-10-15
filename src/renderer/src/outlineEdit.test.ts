import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { indentAt, insertAfter, labelFor, moveAt, outdentAt, readLabelRanges, removeAt, updateAt, writeLabelRanges, writeOutline, type BookmarkNode } from './outlineEdit'

const leaf = (title: string, page: number): BookmarkNode => ({ title, page, children: [] })

describe('bookmark tree edits', () => {
  const tree = [leaf('A', 0), leaf('B', 1), leaf('C', 2)]
  it('inserts, renames, moves and removes', () => {
    let { tree: t, path } = insertAfter(tree, [0], leaf('A2', 0))
    expect(t.map((n) => n.title)).toEqual(['A', 'A2', 'B', 'C'])
    expect(path).toEqual([1])
    t = updateAt(t, path, { title: 'A two' })
    ;({ tree: t, path } = moveAt(t, path, 1))
    expect(t.map((n) => n.title)).toEqual(['A', 'B', 'A two', 'C'])
    t = removeAt(t, path)
    expect(t.map((n) => n.title)).toEqual(['A', 'B', 'C'])
  })
  it('indents under the sibling above and outdents back', () => {
    let { tree: t, path } = indentAt(tree, [1])
    expect(t.map((n) => n.title)).toEqual(['A', 'C'])
    expect(t[0].children.map((n) => n.title)).toEqual(['B'])
    expect(path).toEqual([0, 0])
    ;({ tree: t, path } = outdentAt(t, path))
    expect(t.map((n) => n.title)).toEqual(['A', 'B', 'C'])
    expect(path).toEqual([1])
  })
})

describe('writing', () => {
  async function pdf(n: number) {
    const doc = await PDFDocument.create()
    for (let i = 0; i < n; i++) doc.addPage()
    return doc.save()
  }
  it('writes a nested outline that pdf-lib can read back', async () => {
    const out = await writeOutline(await pdf(3), [{ title: 'Part 1', page: 0, children: [leaf('Section', 1)] }, leaf('Part 2', 2)])
    const doc = await PDFDocument.load(out)
    const root = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    const title = (d: PDFDict) => (d.lookup(PDFName.of('Title')) as PDFHexString).decodeText()
    const first = root.lookup(PDFName.of('First'), PDFDict)
    const second = first.lookup(PDFName.of('Next'), PDFDict)
    const child = first.lookup(PDFName.of('First'), PDFDict)
    expect([title(first), title(second), title(child)]).toEqual(['Part 1', 'Part 2', 'Section'])
    expect(first.lookup(PDFName.of('Count'), PDFNumber).asNumber()).toBe(-1)
    // Destinations point at the right pages.
    const destPage = (d: PDFDict) => doc.getPages().findIndex((p) => p.ref === d.lookup(PDFName.of('Dest'), PDFArray).get(0))
    expect([destPage(first), destPage(child), destPage(second)]).toEqual([0, 1, 2])
  })
  it('removes the outline when the tree is empty', async () => {
    const doc = await PDFDocument.load(await writeOutline(await pdf(1), []))
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeUndefined()
  })
  it('writes page labels and reads them back', async () => {
    const out = await writeLabelRanges(await pdf(6), [
      { start: 0, style: 'r', prefix: '', first: 1 },
      { start: 2, style: 'D', prefix: 'A-', first: 1 }
    ])
    const ranges = await readLabelRanges(out)
    expect(ranges).toEqual([
      { start: 0, style: 'r', prefix: '', first: 1 },
      { start: 2, style: 'D', prefix: 'A-', first: 1 }
    ])
    expect([0, 1, 2, 5].map((p) => labelFor(ranges[p < 2 ? 0 : 1], p))).toEqual(['i', 'ii', 'A-1', 'A-4'])
    expect(labelFor({ start: 0, style: 'A', prefix: '', first: 27 }, 0)).toBe('AA')
  })
})
