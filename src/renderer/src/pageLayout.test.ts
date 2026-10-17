import { describe, expect, it } from 'vitest'
import { DEFAULT_MODE, gapFor, layoutRows, modeFromDefaults, rowExtent, rowOfPage } from './pageLayout'

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

describe('right to left and gaps', () => {
  it('turns each pair round when right to left', () => {
    expect(layoutRows(5, { twoUp: true, continuous: true, cover: false, rtl: true })).toEqual([[1, 0], [3, 2], [4]])
  })
  it('keeps the cover page alone and turns the pairs after it', () => {
    expect(layoutRows(4, { twoUp: true, continuous: true, cover: true, rtl: true })).toEqual([[0], [2, 1], [3]])
  })
  it('leaves a single column as it is', () => {
    expect(layoutRows(3, { twoUp: false, continuous: true, cover: false, rtl: true })).toEqual([[0], [1], [2]])
  })
  it('does not change page numbers, only their place in the row', () => {
    const rows = layoutRows(4, { twoUp: true, continuous: true, cover: false, rtl: true })
    expect(rowOfPage(rows)).toEqual([0, 0, 1, 1])
  })
  it('has no gap when gaps are off, and the usual one otherwise', () => {
    expect(gapFor({ ...DEFAULT_MODE, gaps: false }, 12)).toBe(0)
    expect(gapFor({ ...DEFAULT_MODE, gaps: true }, 12)).toBe(12)
    expect(gapFor({ twoUp: false, continuous: true, cover: false }, 12)).toBe(12)
  })
  it('reads saved defaults, ignoring anything odd', () => {
    expect(modeFromDefaults({ twoUp: true, rtl: true, gaps: false, cover: 'yes' })).toEqual({ twoUp: true, continuous: true, cover: false, rtl: true, gaps: false })
    expect(modeFromDefaults(null)).toEqual(DEFAULT_MODE)
  })
})
