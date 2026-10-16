import { describe, expect, it } from 'vitest'
import { effectiveDuplex, effectiveScaling, faceCount, paperCount, paperLabel, placePage, resolveLandscape, selectPages, shouldRotate, type PageSelection } from './printPlan'

const base: PageSelection = { count: 7, range: 'all', current: 2, view: [3, 4], selected: [5, 1], custom: [0, 1, 2, 4, 9], subset: 'all', reverse: false }

describe('selectPages', () => {
  it('takes all, current, view, selected and custom ranges', () => {
    expect(selectPages(base)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(selectPages({ ...base, range: 'current' })).toEqual([2])
    expect(selectPages({ ...base, range: 'view' })).toEqual([3, 4])
    expect(selectPages({ ...base, range: 'selected' })).toEqual([1, 5])
    expect(selectPages({ ...base, range: 'custom' })).toEqual([0, 1, 2, 4]) // 9 is outside the document
  })
  it('falls back to the current page when the view is unknown', () => {
    expect(selectPages({ ...base, range: 'view', view: null })).toEqual([2])
  })
  it('keeps odd or even page numbers', () => {
    expect(selectPages({ ...base, subset: 'odd' })).toEqual([0, 2, 4, 6]) // pages 1, 3, 5, 7
    expect(selectPages({ ...base, subset: 'even' })).toEqual([1, 3, 5]) // pages 2, 4, 6
    expect(selectPages({ ...base, range: 'custom', subset: 'even' })).toEqual([1])
  })
  it('reverses after filtering', () => {
    expect(selectPages({ ...base, subset: 'odd', reverse: true })).toEqual([6, 4, 2, 0])
  })
  it('is empty when a filter leaves nothing', () => {
    expect(selectPages({ ...base, range: 'current', current: 2, subset: 'even' })).toEqual([])
    expect(selectPages({ ...base, range: 'selected', selected: [] })).toEqual([])
  })
})

describe('sheets', () => {
  it('counts faces for each layout', () => {
    expect(faceCount(0, { kind: 'single' })).toBe(0)
    expect(faceCount(7, { kind: 'single' })).toBe(7)
    expect(faceCount(7, { kind: 'nup', perSheet: 4 })).toBe(2)
    expect(faceCount(6, { kind: 'booklet' })).toBe(4)
    expect(faceCount(6, { kind: 'booklet', sides: 'front' })).toBe(2)
    expect(faceCount(6, { kind: 'booklet', sides: 'back' })).toBe(2)
  })
  it('counts paper with and without two-sided printing', () => {
    expect(paperCount(5, 'off')).toBe(5)
    expect(paperCount(5, 'long')).toBe(3)
    expect(paperCount(4, 'short')).toBe(2)
  })
  it('flips booklets on the short edge only when both sides are printed', () => {
    expect(effectiveDuplex('off', { kind: 'booklet' })).toBe('short')
    expect(effectiveDuplex('long', { kind: 'booklet', sides: 'front' })).toBe('off')
    expect(effectiveDuplex('long', { kind: 'single' })).toBe('long')
  })
})

describe('orientation and scaling', () => {
  it('resolves landscape', () => {
    expect(resolveLandscape('auto', { kind: 'single' }, true, false)).toBe(true)
    expect(resolveLandscape('auto', { kind: 'single' }, true, true)).toBe(false)
    expect(resolveLandscape('portrait', { kind: 'single' }, true, false)).toBe(false)
    expect(resolveLandscape('landscape', { kind: 'nup', perSheet: 4 }, false, false)).toBe(true)
    expect(resolveLandscape('auto', { kind: 'nup', perSheet: 2 }, false, false)).toBe(true)
    expect(resolveLandscape('portrait', { kind: 'booklet' }, false, false)).toBe(true)
  })
  it('rotates only one page per sheet on portrait paper', () => {
    expect(shouldRotate(true, { kind: 'single' }, false)).toBe(true)
    expect(shouldRotate(true, { kind: 'single' }, true)).toBe(false)
    expect(shouldRotate(true, { kind: 'nup', perSheet: 4 }, false)).toBe(false)
    expect(shouldRotate(false, { kind: 'single' }, false)).toBe(false)
  })
  it('ignores scaling when several pages share a sheet', () => {
    expect(effectiveScaling({ kind: 'nup', perSheet: 2 }, { kind: 'actual' })).toEqual({ kind: 'fit' })
    expect(effectiveScaling({ kind: 'single' }, { kind: 'actual' })).toEqual({ kind: 'actual' })
  })
  const cell = { w: 400, h: 600 }
  it('places a page for each scaling', () => {
    // A 200 x 100 page in a 400 x 600 cell.
    const page = { w: 200, h: 100 }
    expect(placePage(cell, page, { kind: 'fit' }, true)).toEqual({ x: 0, y: 200, w: 400, h: 200 })
    expect(placePage(cell, page, { kind: 'shrink' }, true)).toEqual({ x: 100, y: 250, w: 200, h: 100 })
    expect(placePage(cell, page, { kind: 'actual' }, false)).toEqual({ x: 0, y: 0, w: 200, h: 100 })
    expect(placePage(cell, page, { kind: 'custom', percent: 50 }, true)).toEqual({ x: 150, y: 275, w: 100, h: 50 })
  })
  it('shrinks only pages that are too big', () => {
    expect(placePage(cell, { w: 800, h: 600 }, { kind: 'shrink' }, true)).toEqual({ x: 0, y: 150, w: 400, h: 300 })
  })
  it('limits custom percentages', () => {
    expect(placePage(cell, { w: 100, h: 100 }, { kind: 'custom', percent: 5000 }, false).w).toBe(400)
    expect(placePage(cell, { w: 100, h: 100 }, { kind: 'custom', percent: 1 }, false).w).toBe(10)
  })
  it('describes paper in millimetres', () => {
    expect(paperLabel('A4', false)).toBe('A4 · 210 x 297 mm')
    expect(paperLabel('A3', true)).toBe('A3 · 420 x 297 mm')
  })
})
