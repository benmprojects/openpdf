import { describe, expect, it } from 'vitest'
import { loupePosition, loupeRegion, paneZoom, stepPaneZoom } from './workspace'

describe('pane zoom', () => {
  const dims = [{ width: 600, height: 800 }, { width: 500, height: 900 }]
  it('fits the widest page, or the whole of the tallest', () => {
    expect(paneZoom('fit-width', { w: 632, h: 500 }, dims, 16)).toBeCloseTo(1)
    expect(paneZoom('fit-page', { w: 632, h: 500 }, dims, 16)).toBeCloseTo((500 - 32) / 900)
  })
  it('clamps numbers and copes with nothing to fit', () => {
    expect(paneZoom(9, { w: 100, h: 100 }, dims, 16)).toBe(4)
    expect(paneZoom(0.01, { w: 100, h: 100 }, dims, 16)).toBe(0.1)
    expect(paneZoom('fit-width', { w: 0, h: 0 }, [], 16)).toBe(1)
  })
  it('steps up and down', () => {
    expect(stepPaneZoom(1, 1)).toBe(1.25)
    expect(stepPaneZoom(1, -1)).toBe(0.75)
    expect(stepPaneZoom(4, 1)).toBe(4)
    expect(stepPaneZoom(0.25, -1)).toBe(0.1)
  })
})

describe('loupe', () => {
  const page = { width: 600, height: 800 }
  it('centres a square on the pointer at the chosen magnification', () => {
    const r = loupeRegion({ x: 300, y: 400 }, page, 200, 1, 3, 1)!
    expect(r.scale).toBe(3)
    expect(r.region).toEqual({ x: 800, y: 1100, w: 200, h: 200 })
  })
  it('stays inside the page near an edge', () => {
    const r = loupeRegion({ x: 0, y: 800 }, page, 200, 1, 3, 1)!
    expect(r.region.x).toBe(0)
    expect(r.region.y + r.region.h).toBe(2400)
  })
  it('allows for a high-density screen and caps the scale', () => {
    expect(loupeRegion({ x: 10, y: 10 }, page, 200, 1, 2, 2)!.region.w).toBe(400)
    expect(loupeRegion({ x: 10, y: 10 }, page, 200, 8, 6, 1)!.scale).toBe(24)
  })
  it('never exceeds a tiny page', () => {
    const r = loupeRegion({ x: 1, y: 1 }, { width: 10, height: 10 }, 200, 1, 2, 1)!
    expect(r.region).toEqual({ x: 0, y: 0, w: 20, h: 20 })
  })
  it('moves to the other side of the pointer near the window edge', () => {
    expect(loupePosition({ x: 100, y: 100 }, 200, { w: 1000, h: 800 })).toEqual({ left: 118, top: 118 })
    expect(loupePosition({ x: 950, y: 750 }, 200, { w: 1000, h: 800 })).toEqual({ left: 732, top: 532 })
  })
})
