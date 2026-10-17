import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { combineFiles, pagesFor, type CombineIo } from './combine'
import { bookmarkTitle, buildOutline, kindOf, moveItem, remapOutline, sortItems, type CombineItem } from './combineLogic'
import type { BookmarkNode } from './outlineEdit'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'))

async function pdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([200 + i, 300])
  return d.save()
}

const node = (title: string, page: number, children: BookmarkNode[] = []): BookmarkNode => ({ title, page, children })

describe('kindOf and ordering', () => {
  it('sorts files by extension kind', () => {
    expect(kindOf('A.PDF')).toBe('pdf')
    expect(kindOf('scan.TIFF')).toBe('picture')
    expect(kindOf('x.webp')).toBe('picture')
    expect(kindOf('brief.docx')).toBe('office')
    expect(kindOf('notes.txt')).toBeNull()
  })
  it('sorts by name with numbers as numbers, and by date', () => {
    const items = [
      { name: 'b10.pdf', mtime: 3 },
      { name: 'B2.pdf', mtime: 1 },
      { name: 'a.pdf', mtime: 2 }
    ]
    expect(sortItems(items, 'name').map((i) => i.name)).toEqual(['a.pdf', 'B2.pdf', 'b10.pdf'])
    expect(sortItems(items, 'date').map((i) => i.name)).toEqual(['B2.pdf', 'a.pdf', 'b10.pdf'])
    expect(sortItems(items, 'date', true).map((i) => i.name)).toEqual(['b10.pdf', 'a.pdf', 'B2.pdf'])
  })
  it('moves an item', () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
    expect(moveItem([1, 2, 3], 1, 99)).toEqual([1, 3, 2])
    expect(moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3])
  })
  it('names a bookmark after the file', () => {
    expect(bookmarkTitle('Site report v2.final.pdf')).toBe('Site report v2.final')
  })
})

describe('remapOutline', () => {
  it('moves pages by the offset and drops bookmarks to pages left out', () => {
    const tree = [node('One', 0), node('Two', 1, [node('Two a', 2), node('Two b', 3)]), node('Three', 4)]
    const out = remapOutline(tree, [1, 2, 3], 10)
    expect(out).toEqual([node('Two', 10, [node('Two a', 11), node('Two b', 12)])])
  })
  it('keeps a parent whose own page was left out when a child survives', () => {
    const out = remapOutline([node('Part', 0, [node('Sec', 2)])], [2], 5)
    expect(out).toEqual([node('Part', 5, [node('Sec', 5)])])
  })
})

describe('buildOutline', () => {
  const entries = [
    { name: 'A.pdf', offset: 0, pages: [0, 1], outline: [node('A1', 1)] },
    { name: 'B.png', offset: 2, pages: [0], outline: [] }
  ]
  it('makes a bookmark per file with the file’s own inside', () => {
    expect(buildOutline(entries, true, true)).toEqual([node('A', 0, [node('A1', 1)]), node('B', 2)])
  })
  it('can keep only the files’ own bookmarks, or none', () => {
    expect(buildOutline(entries, false, true)).toEqual([node('A1', 1)])
    expect(buildOutline(entries, false, false)).toEqual([])
  })
})

describe('combineFiles', () => {
  const item = (name: string, kind: CombineItem['kind'], range = ''): CombineItem => ({ id: name, name, path: `/${name}`, kind, size: 1, mtime: 1, range })
  const files = new Map<string, Uint8Array>()
  const io: CombineIo = {
    read: async (p) => files.get(p)!,
    office: async (p) => files.get(p)!,
    outline: async (b) => (b === files.get('/a.pdf') ? [node('Intro', 0), node('Body', 2)] : [])
  }
  it('joins PDFs, a picture and a converted Office file, with ranges and bookmarks', async () => {
    files.set('/a.pdf', await pdf(3))
    files.set('/pic.png', PNG)
    files.set('/memo.docx', await pdf(2))
    const r = await combineFiles([item('a.pdf', 'pdf', '2-3'), item('pic.png', 'picture'), item('memo.docx', 'office', '1')], { bookmarkPerFile: true, keepBookmarks: true, pictureSize: 'a4' }, io)
    expect(r.count).toBe(4)
    const doc = await PDFDocument.load(r.bytes)
    expect(doc.getPageCount()).toBe(4)
    // The first file's pages 2 and 3 (widths 201 and 202), then the picture on A4, then the memo's first page.
    expect(doc.getPage(0).getSize().width).toBe(201)
    expect(doc.getPage(2).getSize().width).toBeCloseTo(595.28, 1)
    const outlines = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    const first = outlines.lookup(PDFName.of('First'), PDFDict)
    expect(first.get(PDFName.of('Dest'))).toBeInstanceOf(PDFArray)
    expect(outlines.get(PDFName.of('Count'))?.toString()).toBe('3')
    // "Intro" (page 1 of a.pdf) was left out; "Body" (page 3) is the second page of the result.
    const kids = first.lookup(PDFName.of('First'), PDFDict)
    expect(kids.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toContain('Body')
  })
  it('has no bookmarks when none are asked for', async () => {
    files.set('/a.pdf', await pdf(1))
    const r = await combineFiles([item('a.pdf', 'pdf')], { bookmarkPerFile: false, keepBookmarks: false, pictureSize: 'image' }, io)
    expect((await PDFDocument.load(r.bytes)).catalog.has(PDFName.of('Outlines'))).toBe(false)
  })
  it('names the file when a range does not fit', async () => {
    files.set('/a.pdf', await pdf(2))
    await expect(combineFiles([item('a.pdf', 'pdf', '5')], { bookmarkPerFile: false, keepBookmarks: false, pictureSize: 'a4' }, io)).rejects.toThrow(/a\.pdf.*outside pages 1 to 2/)
  })
})

describe('pagesFor', () => {
  it('takes all pages for an empty range and reports a bad one', () => {
    expect(pagesFor('', 3)).toEqual({ pages: [0, 1, 2], error: null })
    expect(pagesFor('2-', 4).pages).toEqual([1, 2, 3])
    expect(pagesFor('9', 4).error).toMatch(/outside/)
  })
})
