import { describe, expect, it } from 'vitest'
import { hexString, imageDraws, isShow, matInverse, matMul, num, parseContent, removeOps, showBytes } from './content'

describe('content stream parser', () => {
  it('splits operations with their operands and source ranges', () => {
    const src = 'q 1 0 0 1 10 20 cm BT /F1 12 Tf (Hello \\(world\\)) Tj ET Q'
    const ops = parseContent(src)
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'BT', 'Tf', 'Tj', 'ET', 'Q'])
    expect(ops[1].operands.map((t) => (t.t === 'num' ? t.v : NaN))).toEqual([1, 0, 0, 1, 10, 20])
    expect(src.slice(ops[4].start, ops[4].end)).toBe('(Hello \\(world\\)) Tj')
    expect(showBytes(ops[4])).toBe('Hello (world)')
  })

  it('reads TJ arrays, hex strings, octal escapes and comments', () => {
    const ops = parseContent('% comment\n[(A) -120 <4142> (\\101\\102)] TJ')
    expect(ops).toHaveLength(1)
    expect(isShow(ops[0])).toBe(true)
    expect(showBytes(ops[0])).toBe('AABAB')
  })

  it('keeps inline images whole, even when the data looks like operators', () => {
    // The data contains "EI" and "Tj" but only a whitespace-delimited EI ends it.
    const src = 'q BI /W 2 /H 1 /CS /G /BPC 8 ID aEIb Tj (x)\nEI Q (after) Tj'
    const ops = parseContent(src)
    expect(ops.map((o) => o.op)).toEqual(['q', 'BI', 'Q', 'Tj'])
    expect(showBytes(ops[3])).toBe('after')
  })

  it('handles names with escapes, dictionaries and numbers without leading digits', () => {
    const ops = parseContent('/Span <</MCID 0 /Lang (en)>> BDC -.5 +3 m EMC')
    expect(ops.map((o) => o.op)).toEqual(['BDC', 'm', 'EMC'])
    expect(ops[0].operands[0]).toEqual({ t: 'name', v: 'Span' })
    expect(ops[1].operands).toEqual([{ t: 'num', v: -0.5 }, { t: 'num', v: 3 }])
  })

  it('removes chosen operations and leaves the rest byte for byte', () => {
    const src = 'BT /F1 12 Tf 10 700 Td (one) Tj 0 -14 Td (two) Tj ET'
    const ops = parseContent(src)
    const shows = ops.map((o, i) => (isShow(o) ? i : -1)).filter((i) => i >= 0)
    expect(removeOps(src, ops, new Set([shows[0]]))).toBe('BT /F1 12 Tf 10 700 Td 0 -14 Td (two) Tj ET')
    expect(removeOps(src, ops, new Set())).toBe(src)
  })

  it('formats numbers and hex strings', () => {
    expect(num(1.5)).toBe('1.5')
    expect(num(12)).toBe('12')
    expect(num(0.1 + 0.2)).toBe('0.3')
    expect(hexString('AB')).toBe('<4142>')
  })
})

describe('images in content', () => {
  it('lists image draws with the transform they are drawn under, skipping forms', () => {
    const src = 'q 200 0 0 100 50 60 cm /Im1 Do Q q /Fm1 Do Q q 1 0 0 1 10 10 cm 30 0 0 30 5 5 cm BI /W 1 /H 1 ID x EI Q'
    const d = imageDraws(parseContent(src), (n) => n.startsWith('Im'))
    expect(d).toHaveLength(2)
    expect(d[0]).toMatchObject({ name: 'Im1', ctm: [200, 0, 0, 100, 50, 60] })
    expect(d[1].name).toBeUndefined()
    expect(d[1].ctm).toEqual([30, 0, 0, 30, 15, 15])
  })

  it('inverts affine matrices', () => {
    const m: [number, number, number, number, number, number] = [2, 1, -1, 3, 10, 20]
    const inv = matInverse(m)!
    const id = matMul(m, inv)
    expect(id.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0, 1, 0, 0])
    expect(matInverse([0, 0, 0, 0, 1, 1])).toBeNull()
  })
})
