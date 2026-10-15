import { describe, expect, it } from 'vitest'
import { layoutRows, rowExtent, rowOfPage } from './pageLayout'

describe('layoutRows', () => {
  it('puts one page per row when not two-up', () => {
    expect(layoutRows(3, { twoUp: false, continuous: true, cover: false })).toEqual([[0], [1], [2]])
  })
  it('pairs pages two-up', () => {
    expect(layoutRows(5, { twoUp: true, continuous: true, cover: false })).toEqual([[0, 1], [2, 3], [4]])
  })
  it('keeps the cover page alone', () => {
    expect(layoutRows(4, { twoUp: true, continuous: false, cover: true })).toEqual([[0], [1, 2], [3]])
    expect(layoutRows(1, { twoUp: true, continuous: true, cover: true })).toEqual([[0]])
  })
  it('handles an empty document', () => {
    expect(layoutRows(0, { twoUp: true, continuous: true, cover: true })).toEqual([])
  })
})

describe('rowOfPage and rowExtent', () => {
  const rows = [[0], [1, 2]]
  it('maps pages to rows', () => {
    expect(rowOfPage(rows)).toEqual([0, 1, 1])
  })
  it('measures the widest and tallest row', () => {
    const dims = [
      { width: 100, height: 200 },
      { width: 100, height: 150 },
      { width: 120, height: 180 }
    ]
    expect(rowExtent(rows, dims, 10)).toEqual({ maxWidth: 230, maxHeight: 200 })
  })
})
