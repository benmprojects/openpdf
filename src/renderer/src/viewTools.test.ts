import { describe, expect, it } from 'vitest'
import { formatLength, formatPageSize, formatPosition, overviewScale, overviewToPage, paperName, viewportRect, zoomForWidth } from './viewTools'

describe('readout', () => {
  it('formats A4 in millimetres', () => {
    expect(formatPageSize(595.28, 841.89, 'mm')).toBe('210.0 × 297.0 mm')
  })
  it('uses the precision of each unit', () => {
    expect(formatLength(72, 'in')).toBe('1.00')
    expect(formatLength(72, 'pt')).toBe('72.0')
    expect(formatLength(72 / 2.54, 'cm')).toBe('1.00')
  })
  it('formats a pointer position', () => {
    expect(formatPosition(72, 144, 'in')).toBe('x 1.00, y 2.00 in')
  })
  it('names standard papers in either orientation', () => {
    expect(paperName(595.28, 841.89)).toBe('A4')
    expect(paperName(841.89, 595.28)).toBe('A4')
    expect(paperName(2383.94, 3370.39)).toBe('A0')
    expect(paperName(500, 500)).toBeNull()
  })
})

describe('pan and zoom window', () => {
  it('fits a page into the overview', () => {
    expect(overviewScale(600, 800, 150, 150)).toBeCloseTo(0.1875)
    expect(overviewScale(0, 800, 150, 150)).toBe(1)
  })
  it('maps the viewport to overview pixels and back', () => {
    const r = viewportRect({ u: 100, v: 200, w: 300, h: 400 }, 0.5)
    expect(r).toEqual({ x: 50, y: 100, w: 150, h: 200 })
    expect(overviewToPage(50, 100, 0.5, 600, 800)).toEqual({ u: 100, v: 200 })
  })
  it('keeps a dragged point on the page', () => {
    expect(overviewToPage(-10, 9999, 0.5, 600, 800)).toEqual({ u: 0, v: 800 })
  })
  it('zooms in when the rectangle is made narrower, within limits', () => {
    expect(zoomForWidth(1, 400, 200)).toBe(2)
    expect(zoomForWidth(1, 400, 800)).toBe(0.5)
    expect(zoomForWidth(1, 400, 1)).toBe(8)
    expect(zoomForWidth(1, 0, 100)).toBe(1)
  })
})
