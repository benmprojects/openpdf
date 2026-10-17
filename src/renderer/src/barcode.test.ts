import { describe, expect, it } from 'vitest'
import { CODE128_PATTERNS, australianDate, barcodeShape, code128Values, ean13Check, encodeQr, fillTemplate, qrDataCodewords, type BarcodeShape } from './barcode'

/** The widths of consecutive bars and spaces (bar first) of a bar code's shape, as one string of digits. */
function widthsOf(s: BarcodeShape): string {
  let out = ''
  let at = 0
  for (const r of s.rects) {
    if (r.x > at) out += String(r.x - at)
    out += String(r.w)
    at = r.x + r.w
  }
  return out
}

const rowsOf = (m: boolean[][]) => m.map((r) => r.map((v) => (v ? '1' : '0')).join(''))

describe('QR code', () => {
  it('holds the data capacity the standard lists for versions 1 and 40', () => {
    expect([qrDataCodewords(1, 'L'), qrDataCodewords(1, 'M'), qrDataCodewords(1, 'Q'), qrDataCodewords(1, 'H')]).toEqual([19, 16, 13, 9])
    expect([qrDataCodewords(40, 'L'), qrDataCodewords(40, 'M'), qrDataCodewords(40, 'Q'), qrDataCodewords(40, 'H')]).toEqual([2956, 2334, 1666, 1276])
    // Data codewords per version at level M (ISO/IEC 18004 table 7).
    expect([2, 3, 4, 5, 10, 20].map((v) => qrDataCodewords(v, 'M'))).toEqual([28, 44, 64, 86, 216, 669])
  })

  // Reference matrices from an independent encoder (the Python qrcode package), compared module by module.
  it('matches a reference encoder for HELLO WORLD at level M (version 1, alphanumeric)', () => {
    const q = encodeQr('HELLO WORLD', 'M')
    expect(q.version).toBe(1)
    expect(rowsOf(q.modules)).toEqual([
      '111111100010101111111', '100000101110001000001', '101110100010101011101', '101110100010101011101', '101110101011101011101', '100000100111001000001', '111111101010101111111',
      '000000000000000000000', '101010100100100010010', '011110001001000010001', '000111111101001011000', '111101011001110101110', '010011110101001110101', '000000001010001000101',
      '111111100000100101100', '100000100110001101000', '101110101100101111111', '101110100011010100010', '101110101111011101001', '100000100001110001011', '111111101101011100001'
    ])
  })

  it('matches a reference encoder for a longer byte-mode text at level Q with mask 3 (version 3)', () => {
    const q = encodeQr('https://example.com/a?b=1', 'Q', { mask: 3 })
    expect(q.version).toBe(3)
    expect(q.size).toBe(29)
    expect(rowsOf(q.modules)).toEqual([
      '11111110011101100000001111111', '10000010100000000100001000001', '10111010110000001011001011101', '10111010000110011100001011101', '10111010001111110001001011101',
      '10000010000100011111001000001', '11111110101010101010101111111', '00000000000101000000100000000', '01110110000000110010000000110', '01001101001011111110111111101',
      '00000011100111101111101011010', '00111101100010100010100110001', '01111010101111100101110100111', '11010100110001101111001101101', '10111011000001010001101111011',
      '10111100010110110000111011001', '10000011111011010100100011000', '01101101100001000011010000100', '10011010011101000010101111000', '00101101000010111100111100110',
      '01110111101111111111111111100', '00000000110011000110100011011', '11111110010001101011101010110', '10000010101110100100100010000', '10111010001000111000111111101',
      '10111010101100100001000011010', '10111010100101000010100100101', '10000010101100010011101011010', '11111110000011100010110100010'
    ])
  })

  it('has the fixed patterns in place: finders, timing and the dark module', () => {
    const q = encodeQr('1', 'L')
    const m = q.modules
    expect(m[0].slice(0, 7)).toEqual(Array(7).fill(true))
    expect(m[3][3]).toBe(true)
    expect(m[7].slice(0, 8)).toEqual(Array(8).fill(false))
    for (let i = 8; i < q.size - 8; i++) expect(m[6][i]).toBe(i % 2 === 0)
    expect(m[q.size - 8][8]).toBe(true)
  })

  it('picks the smallest version, and a larger one as the text grows', () => {
    expect(encodeQr('A'.repeat(25), 'L').version).toBe(1)
    expect(encodeQr('a'.repeat(18), 'L').version).toBe(2)
    expect(encodeQr('a'.repeat(1000), 'M').version).toBe(26)
    expect(encodeQr('x'.repeat(2953), 'L').version).toBe(40)
  })

  it('refuses text that cannot fit', () => {
    expect(() => encodeQr('x'.repeat(2954), 'L')).toThrow(/too much text/)
    expect(() => barcodeShape('qr', '')).toThrow()
  })

  it('draws the same modules as rectangles', () => {
    const s = barcodeShape('qr', 'HELLO WORLD', 'M')
    const q = encodeQr('HELLO WORLD', 'M')
    const dark = s.rects.reduce((n, r) => n + r.w * r.h, 0)
    expect(dark).toBe(q.modules.flat().filter(Boolean).length)
    expect(s.width).toBe(21)
    expect(s.is2d).toBe(true)
  })
})

describe('Code 128', () => {
  // Reference bar and space widths from an independent encoder (bwip-js).
  it('encodes text in Code B', () => {
    expect(widthsOf(barcodeShape('code128', 'Hello'))).toBe('2112142311131122142211142211141341112211142331112')
    expect(widthsOf(barcodeShape('code128', 'PJJ123C'))).toBe('2112143131211121331121331232212232112211321313213113212331112')
    expect(widthsOf(barcodeShape('code128', 'Order 4567-A'))).toBe('2112141331211212411412211122141212412122221131411131231411221141311221321113231422112331112')
  })

  it('packs digits in Code C and puts an odd last digit in Code B', () => {
    expect(widthsOf(barcodeShape('code128', '12345678'))).toBe('2112321122321311233311212411121331212331112')
    expect(widthsOf(barcodeShape('code128', '12345'))).toBe('2112321122321311231141312132123111232331112')
  })

  it('uses Code A for control characters', () => {
    expect(widthsOf(barcodeShape('code128', 'AB\u0001cd'))).toBe('2114121113231311231211241141311411221412211141312331112')
  })

  it('computes the check symbol (modulo 103)', () => {
    // 104 + 40 + 69*2 + 76*3 + 76*4 + 79*5 = 1209, and 1209 mod 103 = 76
    expect(code128Values('Hello')).toEqual([104, 40, 69, 76, 76, 79, 76, 106])
  })

  it('every symbol is 11 modules wide, the stop is 13, and the symbols are distinct', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    const sum = (p: string) => [...p].reduce((n, d) => n + Number(d), 0)
    CODE128_PATTERNS.slice(0, 106).forEach((p) => expect(sum(p)).toBe(11))
    expect(sum(CODE128_PATTERNS[106])).toBe(13)
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
    // Start C (11) + two pairs (22) + check (11) + stop (13)
    expect(barcodeShape('code128', '0000').width).toBe(11 + 22 + 11 + 13)
  })

  it('rejects text beyond ASCII', () => {
    expect(() => barcodeShape('code128', 'café ✓')).toThrow(/ASCII/)
    expect(() => barcodeShape('code128', '')).toThrow()
  })
})

describe('Code 39', () => {
  it('encodes every allowed character (reference from an independent encoder, which adds a trailing space)', () => {
    expect(widthsOf(barcodeShape('code39', 'HELLO-123 $/+%.'))).toBe(
      '1311313111311113311131113311111131111331113111133131113113111311113131311311113111331111313133111111133111311113131311111313111311131113131111131313113311113111131131311'
    )
  })
  it('upper-cases and refuses other characters', () => {
    expect(widthsOf(barcodeShape('code39', 'abc'))).toBe(widthsOf(barcodeShape('code39', 'ABC')))
    expect(() => barcodeShape('code39', 'a*b')).toThrow()
    expect(() => barcodeShape('code39', 'café')).toThrow(/Code 39/)
  })
})

describe('EAN-13', () => {
  it('adds the check digit to twelve digits and matches reference bars', () => {
    expect(ean13Check('590123412345')).toBe(7)
    expect(ean13Check('978020137962')).toBe(4)
    expect(widthsOf(barcodeShape('ean13', '590123412345'))).toBe('11131121123122221221411231111111222121221411113212311312111')
    expect(widthsOf(barcodeShape('ean13', '9780201379624'))).toBe('11113123121112321221123222111111141113123112111421221132111')
    expect(barcodeShape('ean13', '590123412345').label).toBe('5901234123457')
    expect(barcodeShape('ean13', '590123412345').width).toBe(95)
  })
  it('checks a typed check digit and the length', () => {
    expect(() => barcodeShape('ean13', '5901234123458')).toThrow(/check digit should be 7/)
    expect(() => barcodeShape('ean13', '12345')).toThrow(/12 digits/)
    expect(() => barcodeShape('ean13', '59012341234a')).toThrow()
  })
})

describe('text templates', () => {
  const v = { filename: 'Drawing A101.pdf', page: 3, pages: 12, date: new Date(2026, 9, 5) }
  it('fills the fields', () => {
    expect(fillTemplate('{filename}|{page}/{pages}|{date}', v)).toBe('Drawing A101|3/12|05/10/2026')
  })
  it('leaves unknown braces alone and repeats fields', () => {
    expect(fillTemplate('{page}{page} {other}', v)).toBe('33 {other}')
  })
  it('formats dates as DD/MM/YYYY', () => {
    expect(australianDate(new Date(2027, 0, 31))).toBe('31/01/2027')
  })
})
