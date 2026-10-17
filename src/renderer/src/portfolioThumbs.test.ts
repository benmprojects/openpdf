import { describe, expect, it } from 'vitest'
import { rgbaToRgb } from './portfolioThumbs'

describe('rgbaToRgb', () => {
  it('drops the alpha channel and lays transparent pixels over white', () => {
    const out = rgbaToRgb(new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0, 100, 100, 100, 128]), 3, 1)
    expect(Array.from(out.slice(0, 3))).toEqual([10, 20, 30])
    expect(Array.from(out.slice(3, 6))).toEqual([255, 255, 255])
    expect(out[6]).toBeGreaterThan(100)
    expect(out[6]).toBeLessThan(255)
  })
})
