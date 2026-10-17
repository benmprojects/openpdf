import { describe, expect, it } from 'vitest'
import { sheetGeometry } from './tilePrint'
import { printTiles, tileSheets } from '../../shared/tiling'

describe('sheetGeometry', () => {
  const area = { w: 500, h: 700 }
  it('maps a tile to a pixel region at print resolution', () => {
    const g = printTiles(1000, 700, 500, 700, 1, 0)
    const geo = sheetGeometry({ w: 1000, h: 700 }, g.tiles[1], area, 100, 72)
    expect(geo).toMatchObject({ scale: 1, x: 500, y: 0, w: 500, h: 700, pageW: 500, pageH: 700 })
  })
  it('knows how much of the last sheet the page fills', () => {
    const g = printTiles(800, 700, 500, 700, 1, 0)
    const geo = sheetGeometry({ w: 800, h: 700 }, g.tiles[1], area, 100, 72)
    expect(geo.pageW).toBe(300)
  })
  it('scales the region with the tile scale and resolution', () => {
    const g = printTiles(1000, 700, 500, 700, 2, 0)
    const geo = sheetGeometry({ w: 1000, h: 700 }, g.tiles[1], area, 200, 144)
    expect(geo.scale).toBe(4)
    expect(geo.w).toBe(1000)
    expect(geo.x).toBe(Math.round(g.tiles[1].x * 4))
  })
})

describe('tileSheets', () => {
  it('lists each page tiles in turn', () => {
    const s = tileSheets([{ w: 1000, h: 700 }, { w: 400, h: 400 }], { w: 500, h: 700 }, { scalePct: 100, overlapMm: 0 })
    expect(s.map((x) => [x.page, x.tile.col])).toEqual([[0, 0], [0, 1], [1, 0]])
    expect(s[1].grid).toEqual({ rows: 1, cols: 2 })
  })
})
