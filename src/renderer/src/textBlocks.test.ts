import { describe, expect, it } from 'vitest'
import type { TextObject } from './pdfiumRaw'
import { groupBlocks } from './textBlocks'

let n = 0
/** A text run at page-space (x, y) of a given width, in 12 pt Helvetica unless overridden. */
const run = (text: string, x: number, y: number, w: number, over: Partial<TextObject> = {}): TextObject => ({
  ordinal: n++,
  rect: { x, y: 800 - y - 12, w, h: 12 },
  text,
  font: 'Helvetica',
  flags: 32,
  weight: 0,
  italic: false,
  embedded: false,
  size: 12,
  color: '#000000',
  mode: 0,
  matrix: [1, 0, 0, 1, x, y],
  ...over
})

describe('groupBlocks', () => {
  it('joins evenly spaced lines of one style into a paragraph, with an indented first line', () => {
    n = 0
    const o = [run('The quick brown fox', 90, 700, 120), run('jumps over the lazy', 72, 686, 118), run('dog and keeps going.', 72, 672, 116)]
    const b = groupBlocks(o, 0)
    expect(b).toHaveLength(1)
    expect(b[0].reflow).toBe(true)
    expect(b[0].ordinals).toEqual([0, 1, 2])
    expect(b[0].text).toBe('The quick brown fox jumps over the lazy dog and keeps going.')
    expect(b[0].layout.firstX).toBe(90)
    expect(b[0].layout.restX).toBe(72)
    expect(b[0].layout.leading).toBe(14)
    expect(b[0].layout.baselineY).toBe(700)
  })

  it('joins runs on one baseline (a word at a time) into one line, spacing them by their gaps', () => {
    n = 0
    const o = [run('Hello', 72, 700, 30), run('world', 106, 700, 30), run('again', 140, 700, 30)]
    const b = groupBlocks(o, 0)
    expect(b).toHaveLength(1)
    expect(b[0].reflow).toBe(true)
    expect(b[0].text).toBe('Hello world again')
  })

  it('starts a new block when the style, the spacing or the left edge changes', () => {
    n = 0
    const o = [
      run('Heading', 72, 700, 50, { size: 18, matrix: [1, 0, 0, 1, 72, 700] }),
      run('Body line one', 72, 680, 70),
      run('and body line two', 72, 666, 70),
      run('Far below', 72, 560, 50),
      run('Bold start', 72, 546, 50, { font: 'Helvetica-Bold' })
    ]
    const b = groupBlocks(o, 0)
    expect(b.map((x) => x.ordinals)).toEqual([[0], [1, 2], [3], [4]])
    expect(b[0].reflow).toBe(false)
    expect(b[1].reflow).toBe(true)
  })

  it('leaves rotated text, invisible text and rotated pages as single runs', () => {
    n = 0
    const sideways = run('Sideways', 100, 400, 50, { matrix: [0, 1, -1, 0, 100, 400] })
    const hidden = run('Hidden', 72, 700, 40, { mode: 3 })
    expect(groupBlocks([sideways, hidden], 0).map((x) => x.reflow)).toEqual([false, false])
    n = 0
    const lines = [run('One', 72, 700, 20), run('Two', 72, 686, 20)]
    expect(groupBlocks(lines, 90).map((x) => x.ordinals)).toEqual([[0], [1]])
  })

  it('does not merge lines that are too far apart or that wander left and right', () => {
    n = 0
    const far = [run('A', 72, 700, 10), run('B', 72, 650, 10)]
    expect(groupBlocks(far, 0)).toHaveLength(2)
    n = 0
    const ragged = [run('first line of text', 72, 700, 100), run('and second line', 72, 686, 90), run('C', 120, 672, 10)]
    expect(groupBlocks(ragged, 0).map((x) => x.ordinals)).toEqual([[0, 1], [2]])
  })

  it('does not take a column of short, uneven entries (a table) for a paragraph', () => {
    n = 0
    const column = [run('A', 72, 700, 10), run('Longer entry here', 72, 686, 90), run('Mid entry', 72, 672, 50), run('Another long entry', 72, 658, 95)]
    // Capitalised cells never read as a continuation, so no two-line pair forms.
    const b = groupBlocks(column, 0)
    expect(b.every((x) => x.ordinals.length === 1)).toBe(true)
  })

  it('keeps a ragged-right paragraph together and caps the size of a block', () => {
    n = 0
    const para = [run('Ragged right text with', 72, 700, 120), run('lines of slightly different', 72, 686, 112), run('length, as paragraphs do', 72, 672, 105), run('end here.', 72, 658, 40)]
    expect(groupBlocks(para, 0)).toHaveLength(1)
    n = 0
    const tall = Array.from({ length: 70 }, (_, i) => run('A full width line of text', 72, 780 - i * 10.5, 120, { size: 8, matrix: [1, 0, 0, 1, 72, 780 - i * 10.5] }))
    expect(groupBlocks(tall, 0).length).toBeGreaterThan(1)
  })

  it('joins two lines only when the second continues the first', () => {
    n = 0
    const wrapped = [run('The surface is to be compacted until', 72, 700, 160), run('it reaches the specified density.', 72, 686, 140)]
    expect(groupBlocks(wrapped, 0)).toHaveLength(1)
    n = 0
    const cells = [run('Concrete supplier', 72, 700, 80), run('Pipe supplier', 72, 686, 70)]
    expect(groupBlocks(cells, 0)).toHaveLength(2)
  })

  it('keeps a three-line paragraph whole even when its second line starts a sentence', () => {
    n = 0
    const para = [run('Work must stop at the end of the day.', 72, 700, 170), run('The Superintendent will inspect the works', 72, 686, 180), run('before concreting begins.', 72, 672, 110)]
    expect(groupBlocks(para, 0).map((b) => b.ordinals)).toEqual([[0, 1, 2]])
  })

  it('does not turn a grid of single-character cells into a paragraph', () => {
    n = 0
    const grid: ReturnType<typeof run>[] = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) grid.push(run('X', 72 + c * 30, 700 - r * 14, 8))
    const b = groupBlocks(grid, 0)
    expect(b).toHaveLength(18)
    expect(b.every((x) => x.ordinals.length === 1)).toBe(true)
  })

  it('does not merge a column of single words either', () => {
    n = 0
    const col = [run('Alpha', 72, 700, 30), run('Bravo', 72, 686, 30), run('Charl', 72, 672, 30)]
    expect(groupBlocks(col, 0).every((x) => x.ordinals.length === 1)).toBe(true)
  })
})
