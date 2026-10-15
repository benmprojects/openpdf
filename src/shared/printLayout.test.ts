import { describe, expect, it } from 'vitest'
import { sheetGrid, sheetSlots } from './printLayout'

describe('sheetSlots', () => {
  it('prints one page per sheet', () => {
    expect(sheetSlots(3, { kind: 'single' })).toEqual([[0], [1], [2]])
  })
  it('fills N-up sheets in order and leaves the rest blank', () => {
    expect(sheetSlots(5, { kind: 'nup', perSheet: 4 })).toEqual([
      [0, 1, 2, 3],
      [4, null, null, null]
    ])
  })
  it('imposes an 8-page booklet', () => {
    // Sheet 1 front 8|1, back 2|7; sheet 2 front 6|3, back 4|5 (1-based).
    expect(sheetSlots(8, { kind: 'booklet' })).toEqual([
      [7, 0],
      [1, 6],
      [5, 2],
      [3, 4]
    ])
  })
  it('pads a booklet to a multiple of four with blanks at the end', () => {
    expect(sheetSlots(5, { kind: 'booklet' })).toEqual([
      [null, 0],
      [1, null],
      [null, 2],
      [3, 4]
    ])
  })
})

describe('sheetGrid', () => {
  it('uses landscape paper for two-up and booklets', () => {
    expect(sheetGrid({ kind: 'booklet' })).toEqual({ cols: 2, rows: 1, landscape: true })
    expect(sheetGrid({ kind: 'nup', perSheet: 2 }).landscape).toBe(true)
    expect(sheetGrid({ kind: 'nup', perSheet: 9 })).toEqual({ cols: 3, rows: 3, landscape: false })
  })
})
