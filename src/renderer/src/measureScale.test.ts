import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Annot } from './annotations'
import { formatArea, formatLength, readViewports, resultLabel, type Scale } from './measure'
import { measureCsv, measureRows, measureTotals, nextCount } from './measureList'
import { convert, factorForRatio, fractionText, formatQuantity, parseRatio, ratioFromCustom, ratioText } from './measureScale'
import { writePageScales } from './measureWrite'

const scale = (ratio: number, unit: string, precision?: Scale['precision']): Scale => ({ factor: factorForRatio(ratio, unit), unit, source: 'set', label: ratioText(ratio), precision })

describe('ratios', () => {
  it('turns 1:100 into metres per point', () => {
    // 72 pt is 25.4 mm on paper, so 2.54 m at 1:100.
    expect(72 * factorForRatio(100, 'm')).toBeCloseTo(2.54, 9)
    expect(72 * factorForRatio(1, 'mm')).toBeCloseTo(25.4, 9)
    expect(72 * factorForRatio(50, 'cm')).toBeCloseTo(127, 9)
    expect(72 * factorForRatio(1000, 'km')).toBeCloseTo(0.0254, 9)
    expect(72 * factorForRatio(12, 'ft')).toBeCloseTo(1, 9) // 1:12 on a 1 inch line is 1 ft
  })
  it('rejects bad input', () => {
    expect(() => factorForRatio(0, 'm')).toThrow()
    expect(() => factorForRatio(100, 'parsec')).toThrow()
    expect(() => ratioFromCustom(0, 5, 'm')).toThrow()
  })
  it('works out a custom scale: 10 mm on paper = 2 m', () => {
    expect(ratioFromCustom(10, 2, 'm')).toBe(200)
    expect(ratioFromCustom(25.4, 1, 'ft')).toBeCloseTo(12, 9)
  })
  it('writes and reads ratio text', () => {
    expect(ratioText(100)).toBe('1:100')
    expect(ratioText(0.5)).toBe('2:1')
    expect(parseRatio('1:50')).toBe(50)
    expect(parseRatio(' 1 : 2,5 ')).toBe(2.5)
    expect(parseRatio('2:1')).toBe(0.5)
    expect(parseRatio('200')).toBe(200)
    expect(parseRatio('abc')).toBeNull()
    expect(parseRatio('0:5')).toBeNull()
  })
  it('converts units', () => {
    expect(convert(1, 'm', 'mm')).toBe(1000)
    expect(convert(12, 'in', 'ft')).toBeCloseTo(1, 9)
    expect(convert(3, 'ft', 'yd')).toBeCloseTo(1, 9)
  })
})

describe('formatting', () => {
  it('uses automatic precision unless told otherwise', () => {
    expect(formatLength(72, scale(100, 'm'))).toBe('2.54 m')
    expect(formatLength(72, scale(100, 'm', { decimals: 0 }))).toBe('3 m')
    expect(formatLength(72, scale(100, 'm', { decimals: 3 }))).toBe('2.540 m')
    expect(formatArea(72 * 72, scale(100, 'm', { decimals: 1 }))).toBe('6.5 m²')
  })
  it('shows fractions of an inch', () => {
    expect(fractionText(3.5, 8)).toBe('3 1/2')
    expect(fractionText(0.25, 16)).toBe('1/4')
    expect(fractionText(2, 16)).toBe('2')
    expect(fractionText(1.999, 16)).toBe('2')
    expect(formatQuantity(3.4, 'in', { fraction: 8 })).toBe('3 3/8 in')
    expect(formatQuantity(0.3, 'ft', { fraction: 4 })).toBe('1/4 ft')
    // Fractions are for imperial units only.
    expect(formatQuantity(3.4, 'm', { fraction: 8 })).toBe('3.4 m')
  })
  it('shows feet and inches', () => {
    expect(formatQuantity(12.2917, 'ft-in', { fraction: 16 })).toBe(`12' 3 1/2"`)
    expect(formatQuantity(2, 'ft-in', { fraction: 16 })).toBe(`2' 0"`)
    expect(formatQuantity(0.5, 'ft-in', { fraction: 2 })).toBe(`0' 6"`)
    expect(formatQuantity(1 - 0.0001, 'ft-in', { fraction: 16 })).toBe(`1' 0"`) // rounds up into the next foot
    expect(formatQuantity(2.5, 'ft-in', { decimals: 1 })).toBe(`2' 6"`)
    expect(formatArea(72 * 72, scale(12, 'ft-in'))).toBe('1 ft²')
  })
  it('labels a result from the points and scale', () => {
    const pts = [{ x: 0, y: 0 }, { x: 72, y: 0 }]
    expect(resultLabel('distance', pts, scale(100, 'm'))).toBe('2.54 m')
    const sq = [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }]
    expect(resultLabel('area', sq, scale(12, 'in'))).toBe('144 in²')
  })
})

const annot = (id: number, page: number, measure: NonNullable<Annot['measure']>, points?: { x: number; y: number }[]): Annot =>
  ({ id, page, kind: 'line', color: '#000000', rects: [{ x: 0, y: 0, w: 1, h: 1 }], text: '', fontSize: 12, lineWidth: 1, points: points ? [points] : undefined, measure }) as Annot

describe('measurement list', () => {
  const list = [
    annot(2, 1, { kind: 'count', factor: 1, unit: '', label: 'Door', n: 2 }),
    annot(1, 0, { kind: 'distance', factor: 0.1, unit: 'm', label: '5 m', name: 'Kerb' }, [{ x: 0, y: 0 }, { x: 50, y: 0 }]),
    annot(3, 1, { kind: 'count', factor: 1, unit: '', label: 'Door', n: 3 }),
    annot(4, 1, { kind: 'area', factor: 0.1, unit: 'm', label: '1 m²' }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
  ]
  it('lists rows in page order with values in real units', () => {
    const rows = measureRows(list, null)
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4])
    expect(rows[0]).toMatchObject({ type: 'distance', value: 5, unit: 'm', label: 'Kerb', pageLabel: '1' })
    expect(rows[3]).toMatchObject({ type: 'area', value: 1, unit: 'm²' })
    expect(rows[1]).toMatchObject({ type: 'count', value: 1, label: 'Door', result: 'Door #2' })
    expect(measureRows(list, ['i', 'ii'])[1].pageLabel).toBe('ii')
  })
  it('totals counts by label and the rest by type and unit', () => {
    const t = measureTotals(measureRows(list, null))
    expect(t.find((x) => x.type === 'count')).toMatchObject({ label: 'Door', value: 2, items: 2 })
    expect(t.find((x) => x.type === 'distance')).toMatchObject({ value: 5, unit: 'm' })
  })
  it('numbers the next marker in a group', () => {
    expect(nextCount(list, 'Door')).toBe(4)
    expect(nextCount(list, 'Pit')).toBe(1)
  })
  it('exports CSV with quoted fields and totals', () => {
    const csv = measureCsv(measureRows(list, null))
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('"Page","Type","Label","Value","Units","Result"')
    expect(lines[1]).toBe('"1","Distance","Kerb","5","m","5 m"')
    expect(csv).toContain('"Totals","Type","Label","Value","Units","Items"')
    expect(csv).toContain('"","Count","Door","2","count","2"')
    expect(measureCsv([annot(9, 0, { kind: 'distance', factor: 1, unit: 'm', label: 'x', name: 'a "b"' }, [{ x: 0, y: 0 }, { x: 1, y: 0 }])].flatMap((a) => measureRows([a], null))))
      .toContain('"a ""b"""')
  })
})

describe('viewport scale on save', () => {
  it('writes a /Measure viewport per page that readViewports reads back', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 800])
    doc.addPage([600, 800])
    const bytes = await doc.save()
    const out = await writePageScales(bytes, [scale(100, 'm', { decimals: 1 }), null])
    const vp = await readViewports(out)
    expect(vp[0]).toHaveLength(1)
    expect(vp[0][0].scale.unit).toBe('m')
    expect(72 * vp[0][0].scale.factor).toBeCloseTo(2.54, 9)
    expect(vp[0][0].scale.label).toBe('1:100')
    expect(vp[0][0].bbox).toEqual([0, 0, 600, 800])
    expect(vp[1]).toHaveLength(0)
  })
  it('replaces an earlier measure viewport and writes feet and inches as feet', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 800])
    const once = await writePageScales(await doc.save(), [scale(10, 'm')])
    const twice = await writePageScales(once, [scale(12, 'ft-in', { fraction: 16 })])
    const vp = await readViewports(twice)
    expect(vp[0]).toHaveLength(1)
    expect(vp[0][0].scale.unit).toBe('ft')
    expect(72 * vp[0][0].scale.factor).toBeCloseTo(1, 9)
  })
  it('returns the bytes unchanged when no page has a scale', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const bytes = await doc.save()
    expect(await writePageScales(bytes, [null])).toBe(bytes)
  })
})
