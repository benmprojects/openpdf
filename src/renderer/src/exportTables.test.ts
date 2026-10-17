import { describe, expect, it } from 'vitest'
import { detectTables, excelSerial, parseCell, rulesFromSegments, type CellItem, type Rule } from './exportTables'

const item = (text: string, x: number, y: number, w = 50, h = 10): CellItem => ({ text, x, y, w, h, size: 10 })

describe('parseCell', () => {
  it('reads Australian numbers, amounts, percentages and negatives', () => {
    expect(parseCell('1,234.56')).toEqual({ kind: 'number', value: 1234.56, format: '#,##0.00' })
    expect(parseCell('42')).toEqual({ kind: 'number', value: 42, format: '0' })
    expect(parseCell('$1,200')).toEqual({ kind: 'number', value: 1200, format: '"$"#,##0' })
    expect(parseCell('$12.50')).toEqual({ kind: 'number', value: 12.5, format: '"$"0.00' })
    expect(parseCell('12.5%')).toEqual({ kind: 'number', value: 0.125, format: '0.0%' })
    expect(parseCell('(1,500.00)')).toEqual({ kind: 'number', value: -1500, format: '#,##0.00' })
    expect(parseCell('-3.5')).toEqual({ kind: 'number', value: -3.5, format: '0.0' })
  })

  it('reads dates written day first, as Excel serial numbers', () => {
    expect(parseCell('31/12/2026')).toEqual({ kind: 'date', value: excelSerial(2026, 12, 31), format: 'dd/mm/yyyy' })
    expect(parseCell('1/2/26')).toEqual({ kind: 'date', value: excelSerial(2026, 2, 1), format: 'dd/mm/yyyy' })
    expect(parseCell('5 Mar 2025')).toEqual({ kind: 'date', value: excelSerial(2025, 3, 5), format: 'dd/mm/yyyy' })
    expect(excelSerial(1900, 3, 1)).toBe(61)
    expect(excelSerial(2000, 1, 1)).toBe(36526)
    // 13 is not a month, and 30 February is not a day.
    expect(parseCell('1/13/2026').kind).toBe('text')
    expect(parseCell('30/02/2026').kind).toBe('text')
  })

  it('leaves codes, phone numbers and words as text', () => {
    for (const s of ['007', '0412 345 678', 'Pit 4', '1.2.3', '12,5', '1,23', '$', '', 'n/a', '1234567890123456789']) expect(parseCell(s).kind).toBe('text')
  })
})

describe('rulesFromSegments', () => {
  it('keeps straight horizontal and vertical pieces and drops short, slanted and curved ones', () => {
    const rules = rulesFromSegments([0, 10, 100, 10, 1, 5, 0, 5, 50, 1, 0, 0, 100, 40, 1, 0, 20, 100, 20, 0, 0, 30, 3, 30, 1])
    expect(rules.map((r) => r.horizontal)).toEqual([true, false])
  })
})

describe('detectTables', () => {
  it('finds a ruled grid and reads its cells by row and column', () => {
    const rules: Rule[] = []
    const ys = [100, 120, 140, 160]
    const xs = [50, 150, 250]
    for (const y of ys) rules.push({ x0: 50, x1: 250, y0: y, y1: y, horizontal: true })
    for (const x of xs) rules.push({ x0: x, x1: x, y0: 100, y1: 160, horizontal: false })
    const items = [item('Item', 55, 105), item('Cost', 155, 105), item('Pit', 55, 125), item('$10.00', 155, 125), item('Pipe', 55, 145), item('$25.00', 155, 145), item('Outside', 55, 300)]
    const { tables, used } = detectTables(items, rules)
    expect(tables).toHaveLength(1)
    expect(tables[0].ruled).toBe(true)
    expect(tables[0].rows).toEqual([['Item', 'Cost'], ['Pit', '$10.00'], ['Pipe', '$25.00']])
    expect(used.has(6)).toBe(false)
    expect(used.size).toBe(6)
  })

  it('finds a table with horizontal lines only, taking columns from where the text lines up', () => {
    const rules: Rule[] = [100, 120, 140, 160].map((y) => ({ x0: 50, x1: 250, y0: y, y1: y, horizontal: true }))
    const items = [item('No.', 55, 105, 20), item('Description', 120, 105, 60), item('1', 55, 125, 8), item('Kerb', 120, 125, 30), item('2', 55, 145, 8), item('Gutter', 120, 145, 36)]
    const { tables } = detectTables(items, rules)
    expect(tables[0].rows).toEqual([['No.', 'Description'], ['1', 'Kerb'], ['2', 'Gutter']])
  })

  it('finds an unruled table from text in rows and columns, but not a paragraph or a list', () => {
    const table = [item('Item', 50, 100, 30), item('Qty', 200, 100, 20), item('Rate', 300, 100, 30), item('Pit', 50, 115, 20), item('4', 200, 115, 8), item('$85.00', 300, 115, 40), item('Pipe', 50, 130, 25), item('120', 200, 130, 20), item('$42.50', 300, 130, 40)]
    const { tables } = detectTables(table, [])
    expect(tables).toHaveLength(1)
    expect(tables[0].ruled).toBe(false)
    expect(tables[0].rows[2]).toEqual(['Pipe', '120', '$42.50'])
    // Lines of text one under the other, and a short two-row label, are not tables.
    const prose = [item('A long line of ordinary writing.', 50, 100, 300), item('Another line of the same paragraph.', 50, 112, 300), item('And a third line follows here.', 50, 124, 300)]
    expect(detectTables(prose, []).tables).toHaveLength(0)
    expect(detectTables(table.slice(0, 6), []).tables).toHaveLength(0)
  })

  it('does not take two short columns of running sentences for a table', () => {
    const items: CellItem[] = []
    for (let i = 0; i < 6; i++) {
      items.push(item('Left column line number of text', 50, 100 + i * 12, 130))
      items.push(item('Right column line number of text', 250, 100 + i * 12, 130))
    }
    expect(detectTables(items, []).tables).toHaveLength(0)
  })

  it('does not take two text columns of long lines for a table', () => {
    const items: CellItem[] = []
    for (let i = 0; i < 6; i++) {
      items.push(item('This is a long line of text in the left column of a page.', 50, 100 + i * 12, 220))
      items.push(item('This is a long line of text in the right column of a page.', 310, 100 + i * 12, 220))
    }
    expect(detectTables(items, []).tables).toHaveLength(0)
  })
})
