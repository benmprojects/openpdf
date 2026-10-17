import { describe, expect, it } from 'vitest'
import { dataUrlBytes, trimTransparent, whiteToAlpha } from './stampImage'

describe('whiteToAlpha', () => {
  it('makes white transparent and keeps ink', () => {
    const out = whiteToAlpha(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]))
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...out.slice(4, 8)]).toEqual([0, 0, 0, 255])
    expect([...out.slice(8, 12)]).toEqual([255, 0, 0, 255])
  })
  it('gives partial opacity to grey', () => {
    const out = whiteToAlpha(new Uint8Array([128, 128, 128, 255]))
    expect(out[3]).toBe(127)
    expect(out[0]).toBe(0)
  })
})

describe('trimTransparent', () => {
  it('crops to the visible pixels with padding', () => {
    const w = 6
    const h = 5
    const px = new Uint8Array(w * h * 4)
    px[(2 * w + 3) * 4 + 3] = 255
    const r = trimTransparent(px, w, h, 1)
    expect({ w: r.w, h: r.h }).toEqual({ w: 3, h: 3 })
    expect(r.data[(1 * 3 + 1) * 4 + 3]).toBe(255)
  })
  it('keeps an empty image as it is', () => {
    const px = new Uint8Array(16)
    expect(trimTransparent(px, 2, 2).w).toBe(2)
  })
})

describe('dataUrlBytes', () => {
  it('decodes base64 data URLs only', () => {
    expect([...dataUrlBytes('data:image/png;base64,AQID')!]).toEqual([1, 2, 3])
    expect(dataUrlBytes('data:text/plain,hello')).toBeNull()
  })
})
