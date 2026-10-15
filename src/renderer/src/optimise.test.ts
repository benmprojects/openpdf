import { describe, expect, it } from 'vitest'
import { unpredictPng } from './optimise'

describe('unpredictPng', () => {
  it('undoes each PNG filter type', () => {
    // Two pixels per row, one byte each; rows: None, Sub, Up, Average, Paeth.
    const data = new Uint8Array([0, 10, 20, 1, 5, 3, 2, 1, 1, 3, 4, 4, 4, 1, 1])
    expect(Array.from(unpredictPng(data, 2, 1)!)).toEqual([10, 20, 5, 8, 6, 9, 7, 12, 8, 13])
  })
  it('rejects an unknown filter', () => {
    expect(unpredictPng(new Uint8Array([9, 1, 2]), 2, 1)).toBeNull()
  })
})
