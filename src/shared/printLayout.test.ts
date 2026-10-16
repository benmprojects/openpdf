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

describe('booklet options', () => {
  it('puts the spine on the right by swapping each pair', () => {
    expect(sheetSlots(4, { kind: 'booklet', binding: 'right' })).toEqual([
      [0, 3],
      [2, 1]
    ])
  })
  it('prints only the fronts or only the backs', () => {
    expect(sheetSlots(8, { kind: 'booklet', sides: 'front' })).toEqual([
      [7, 0],
      [5, 2]
    ])
    expect(sheetSlots(8, { kind: 'booklet', sides: 'back' })).toEqual([
      [1, 6],
      [3, 4]
    ])
  })
})

describe('N-up page order', () => {
  it('fills columns first when ordered down', () => {
    expect(sheetSlots(4, { kind: 'nup', perSheet: 4, order: 'down' })).toEqual([[0, 2, 1, 3]])
    expect(sheetSlots(6, { kind: 'nup', perSheet: 6, order: 'down' })).toEqual([[0, 3, 1, 4, 2, 5]])
    expect(sheetSlots(3, { kind: 'nup', perSheet: 4, order: 'down' })).toEqual([[0, 2, 1, null]])
  })
})

describe('sheetGrid', () => {
  it('uses landscape paper for two-up and booklets', () => {
    expect(sheetGrid({ kind: 'booklet' })).toEqual({ cols: 2, rows: 1, landscape: true })
    expect(sheetGrid({ kind: 'nup', perSheet: 2 }).landscape).toBe(true)
    expect(sheetGrid({ kind: 'nup', perSheet: 9 })).toEqual({ cols: 3, rows: 3, landscape: false })
  })
})
