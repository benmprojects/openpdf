import { describe, expect, it } from 'vitest'
import { bestPrintLandscape, gridTiles, mmToPt, piecesFor, printTiles, tileLabel, tilesForPaper } from './tiling'

describe('gridTiles', () => {
  it('cuts a page into equal tiles that cover it', () => {
    const g = gridTiles(600, 400, 3, 2, 0)
    expect(g.tiles).toHaveLength(6)
    expect(g.tiles[0]).toMatchObject({ col: 0, row: 0, x: 0, y: 0, w: 200, h: 200 })
    expect(g.tiles[5]).toMatchObject({ col: 2, row: 1, x: 400, y: 200 })
  })
  it('overlaps neighbours and still reaches the far edge', () => {
    const g = gridTiles(600, 400, 2, 1, 20)
    const [a, b] = g.tiles
    expect(a.x + a.w - b.x).toBeCloseTo(20)
    expect(b.x + b.w).toBeCloseTo(600)
    expect(a.h).toBe(400)
  })
  it('keeps one tile whole', () => {
    expect(gridTiles(300, 300, 1, 1, 50).tiles[0]).toMatchObject({ x: 0, y: 0, w: 300, h: 300 })
  })
})

describe('tilesForPaper', () => {
  it('cuts an A1 sheet into A3 pieces', () => {
    const g = tilesForPaper(mmToPt(594), mmToPt(841), mmToPt(297), mmToPt(420), 0, 'portrait')
    expect(g.cols).toBe(2)
    expect(g.rows).toBe(2)
    for (const t of g.tiles) {
      expect(t.w).toBeLessThanOrEqual(mmToPt(297) + 0.01)
      expect(t.h).toBeLessThanOrEqual(mmToPt(420) + mmToPt(1.5))
    }
  })
  it('needs more pieces once an overlap is asked for, and no piece outgrows the paper', () => {
    const g = tilesForPaper(mmToPt(594), mmToPt(841), mmToPt(297), mmToPt(420), mmToPt(10), 'portrait')
    expect(g.cols).toBe(3)
    for (const t of g.tiles) expect(t.w).toBeLessThanOrEqual(mmToPt(297) + 0.01)
  })
  it('turns the paper to suit the page when that needs fewer pieces', () => {
    const g = tilesForPaper(mmToPt(841), mmToPt(594), mmToPt(297), mmToPt(420), 0, 'auto')
    expect(g.paperW).toBeGreaterThan(g.paperH)
    expect(g.tiles).toHaveLength(4)
  })
  it('leaves a page that fits alone', () => {
    expect(tilesForPaper(mmToPt(210), mmToPt(297), mmToPt(297), mmToPt(420), 0).tiles).toHaveLength(1)
  })
})

describe('printTiles', () => {
  it('prints actual size over as many sheets as it takes', () => {
    const g = printTiles(1000, 500, 500, 700, 1, 0)
    expect(g.cols).toBe(2)
    expect(g.rows).toBe(1)
    expect(g.tiles[1]).toMatchObject({ x: 500, y: 0, w: 500, h: 700 })
  })
  it('a smaller scale needs fewer sheets, a larger one more', () => {
    expect(printTiles(1000, 1000, 500, 500, 0.5, 0).tiles).toHaveLength(1)
    expect(printTiles(1000, 1000, 500, 500, 2, 0).tiles).toHaveLength(16)
  })
  it('measures the overlap on the paper, so the page distance shrinks with the scale', () => {
    expect(printTiles(1000, 100, 500, 700, 0.5, 20).tiles).toHaveLength(1) // 500 pt of paper holds what the page takes at 50%
    const h = printTiles(2000, 100, 500, 700, 0.5, 20)
    expect(h.tiles[1].x).toBeCloseTo((500 - 20) / 0.5)
  })
  it('piecesFor counts a length that just fits as one', () => {
    expect(piecesFor(500, 500, 10)).toBe(1)
    expect(piecesFor(510, 500, 10)).toBe(2)
  })
})

describe('orientation and labels', () => {
  it('picks the paper direction that needs fewer sheets', () => {
    expect(bestPrintLandscape(1000, 500, { w: 500, h: 800 }, 1, 0)).toBe(true)
    expect(bestPrintLandscape(500, 1000, { w: 500, h: 800 }, 1, 0)).toBe(false)
  })
  it('labels a tile', () => {
    expect(tileLabel(2, { row: 0, col: 1 }, { rows: 2, cols: 3 })).toBe('Page 3, row 1 column 2 (of 2 x 3)')
  })
})
