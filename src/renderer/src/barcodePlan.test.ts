import { describe, expect, it } from 'vitest'
import { MM, planBarcodes, textFor, type BarcodePlanOptions } from './barcodePlan'

const base: BarcodePlanOptions = {
  kind: 'qr',
  template: '{filename} p{page}/{pages} {date}',
  ecc: 'M',
  showText: true,
  widthMm: 20,
  heightMm: 10,
  marginMm: 10,
  spot: 'bottom-right',
  as: 'content',
  pages: [0, 2],
  sizes: [{ width: 595, height: 842 }, { width: 595, height: 842 }, { width: 842, height: 595 }],
  fileName: 'Drawing A101.pdf',
  date: new Date(2026, 9, 17)
}

describe('barcode plan', () => {
  it('fills the template for each page', () => {
    expect(textFor(base, 1)).toBe('Drawing A101 p2/3 17/10/2026')
    const plan = planBarcodes(base)
    expect(plan.map((p) => p.style.text)).toEqual(['Drawing A101 p1/3 17/10/2026', 'Drawing A101 p3/3 17/10/2026'])
  })

  it('puts the symbol in the chosen corner, inside the margin, per page size', () => {
    const [a, b] = planBarcodes(base)
    expect(a.rect.x + a.rect.w).toBeCloseTo(595 - 10 * MM, 6)
    expect(a.rect.y + a.rect.h).toBeCloseTo(842 - 10 * MM, 6)
    expect(b.rect.x + b.rect.w).toBeCloseTo(842 - 10 * MM, 6)
    expect(b.rect.y + b.rect.h).toBeCloseTo(595 - 10 * MM, 6)
    const tl = planBarcodes({ ...base, spot: 'top-left', pages: [0] })[0]
    expect([tl.rect.x, tl.rect.y]).toEqual([10 * MM, 10 * MM])
    const c = planBarcodes({ ...base, spot: 'centre', pages: [0] })[0]
    expect(c.rect.x + c.rect.w / 2).toBeCloseTo(297.5, 6)
  })

  it('makes a QR code square and a bar code as wide and high as asked', () => {
    const q = planBarcodes(base)[0]
    expect(q.rect.w).toBeCloseTo(q.rect.h, 9)
    const c = planBarcodes({ ...base, kind: 'code128', template: 'A101', widthMm: 50, heightMm: 15, pages: [0] })[0]
    expect(c.rect.w).toBeCloseTo(50 * MM, 9)
    expect(c.rect.h).toBeCloseTo(15 * MM, 9)
  })

  it('stops with a readable message for impossible requests', () => {
    expect(() => planBarcodes({ ...base, pages: [] })).toThrow(/at least one page/)
    expect(() => planBarcodes({ ...base, widthMm: 1 })).toThrow(/too small/)
    expect(() => planBarcodes({ ...base, widthMm: 300 })).toThrow(/does not fit on page 1/)
    expect(() => planBarcodes({ ...base, kind: 'ean13', template: '{page}', pages: [0] })).toThrow(/EAN-13/)
    expect(() => planBarcodes({ ...base, template: '', pages: [0] })).toThrow()
  })
})
