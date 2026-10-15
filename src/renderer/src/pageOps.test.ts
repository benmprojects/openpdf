import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { deletePages, extractPages, insertPagesFrom, movePages, parsePageRanges, rotatePages, splitEvery } from './pageOps'

/** A PDF whose page i has width 100 + i, so pages can be told apart after reordering. */
async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) doc.addPage([100 + i, 200])
  return doc.save()
}
const widths = async (b: Uint8Array) => (await PDFDocument.load(b)).getPages().map((p) => p.getWidth())

describe('parsePageRanges', () => {
  it('parses single pages, ranges and open ranges into sorted 0-based indices', () => {
    expect(parsePageRanges('1-2, 4, 3-', 5)).toEqual([0, 1, 2, 3, 4])
    expect(parsePageRanges('5, 1', 5)).toEqual([0, 4])
    expect(parsePageRanges('2-3,3', 5)).toEqual([1, 2])
  })
  it.each(['9', '0', '3-2', '1-9', 'abc', '1-2-3', '', ' , '])('rejects %j', (s) => {
    expect(() => parsePageRanges(s, 5)).toThrow()
  })
  it('gives a readable message', () => {
    expect(() => parsePageRanges('9', 5)).toThrow('outside pages 1 to 5')
    expect(() => parsePageRanges('', 5)).toThrow('at least one page')
  })
})

describe('page operations', () => {
  let src: Uint8Array
  beforeAll(async () => {
    src = await makePdf(5)
  })

  it('rotates only the chosen pages, accumulating and wrapping', async () => {
    const once = await rotatePages(src, [0, 2], 90)
    const doc = await PDFDocument.load(once)
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 90, 0, 0])
    const back = await PDFDocument.load(await rotatePages(once, [0], -90))
    expect(back.getPage(0).getRotation().angle).toBe(0)
    const wrapped = await PDFDocument.load(await rotatePages(once, [0], 180))
    expect(wrapped.getPage(0).getRotation().angle).toBe(270)
  })

  it('deletes pages and refuses to delete them all', async () => {
    expect(await widths(await deletePages(src, [1, 3]))).toEqual([100, 102, 104])
    await expect(deletePages(src, [0, 1, 2, 3, 4])).rejects.toThrow('at least one page')
  })

  it('moves pages before a target index', async () => {
    expect(await widths(await movePages(src, [0], 5))).toEqual([101, 102, 103, 104, 100])
    expect(await widths(await movePages(src, [3, 4], 1))).toEqual([100, 103, 104, 101, 102])
    expect(await widths(await movePages(src, [2], 0))).toEqual([102, 100, 101, 103, 104])
  })

  it('extracts pages in document order', async () => {
    expect(await widths(await extractPages(src, [3, 1]))).toEqual([101, 103])
  })

  it('inserts pages from another document', async () => {
    const other = await makePdf(2)
    const all = await insertPagesFrom(src, other, 1)
    expect(all.count).toBe(2)
    expect(await widths(all.bytes)).toEqual([100, 100, 101, 101, 102, 103, 104])
    const one = await insertPagesFrom(src, other, 5, [1])
    expect(one.count).toBe(1)
    expect(await widths(one.bytes)).toEqual([100, 101, 102, 103, 104, 101])
  })

  it('splits into chunks of at most N pages', async () => {
    const parts = await splitEvery(src, 2)
    expect(parts.map((p) => [p.first, p.last])).toEqual([[1, 2], [3, 4], [5, 5]])
    expect(await widths(parts[2].bytes)).toEqual([104])
    expect(await widths(parts[1].bytes)).toEqual([102, 103])
  })
})
