import { describe, expect, it } from 'vitest'
import { describeHint, findTables, type HintLine } from './tableHints'

const word = (x0: number, y0: number, w = 60, h = 12) => ({ x0, y0, x1: x0 + w, y1: y0 + h })
const row = (y: number, xs: number[]): HintLine => ({ words: xs.map((x) => word(x, y)) })

describe('findTables', () => {
  it('finds a run of lines whose cells line up', () => {
    const lines = [row(100, [50, 250, 450]), row(120, [50, 250, 450]), row(140, [52, 251, 449]), row(160, [50, 250, 450])]
    const t = findTables(2, lines)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ page: 2, rows: 4, cols: 3 })
    expect(describeHint(t[0])).toBe('Page 3 seems to hold a table (about 4 rows by 3 columns). Check it after recognition.')
  })
  it('ignores ordinary paragraphs', () => {
    const para = (y: number): HintLine => ({ words: Array.from({ length: 10 }, (_, i) => word(50 + i * 64, y)) })
    expect(findTables(0, [para(100), para(118), para(136), para(154)])).toEqual([])
  })
  it('needs at least three lines and columns that really repeat', () => {
    expect(findTables(0, [row(100, [50, 250]), row(120, [50, 250])])).toEqual([])
    expect(findTables(0, [row(100, [50, 250]), row(120, [90, 330]), row(140, [130, 410])])).toEqual([])
  })
  it('splits runs at a big vertical gap', () => {
    const lines = [row(100, [50, 250]), row(120, [50, 250]), row(140, [50, 250]), row(400, [50, 250]), row(420, [50, 250]), row(440, [50, 250])]
    expect(findTables(0, lines)).toHaveLength(2)
  })
})
