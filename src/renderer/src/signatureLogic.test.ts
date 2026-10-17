import { describe, expect, it } from 'vitest'
import { initialsOf, inkBounds, installedFonts, isSignatureCategory, smoothStroke, strokeWidths, TYPED_FONTS, type InkPoint } from './signatureLogic'

const line = (n: number, step = 5, dt = 10): InkPoint[] => Array.from({ length: n }, (_, i) => ({ x: i * step, y: (i % 2) * 2, t: i * dt }))

describe('smoothStroke', () => {
  it('drops jitter, keeps the ends and adds points between corners', () => {
    const jitter: InkPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0.3, y: 0.2, t: 5 },
      { x: 10, y: 10, t: 10 },
      { x: 20, y: 0, t: 20 }
    ]
    const out = smoothStroke(jitter, 1)
    expect(out[0]).toEqual(jitter[0])
    expect(out[out.length - 1]).toEqual(jitter[3])
    // 3 kept points, one round of corner cutting: first + 2 per segment + last.
    expect(out).toHaveLength(6)
  })
  it('keeps a single dot', () => {
    expect(smoothStroke([{ x: 3, y: 3, t: 0 }])).toHaveLength(1)
  })
  it('stays between the original extremes', () => {
    const out = smoothStroke(line(10))
    const b = inkBounds([out])!
    expect(b.x).toBeCloseTo(0)
    expect(b.x + b.w).toBeCloseTo(45)
  })
})

describe('strokeWidths', () => {
  it('draws a fast stroke thinner than a slow one', () => {
    const slow = strokeWidths(line(8, 1, 10), 3)
    const fast = strokeWidths(line(8, 30, 10), 3)
    expect(fast[4]).toBeLessThan(slow[4])
  })
  it('follows pen pressure when there is any', () => {
    const light = strokeWidths(line(6).map((p) => ({ ...p, p: 0.2 })), 3)
    const heavy = strokeWidths(line(6).map((p) => ({ ...p, p: 0.9 })), 3)
    expect(heavy[3]).toBeGreaterThan(light[3])
  })
  it('is empty for no points', () => {
    expect(strokeWidths([], 3)).toEqual([])
  })
})

describe('names and fonts', () => {
  it('makes initials from a name', () => {
    expect(initialsOf('Ben Myers')).toBe('BM')
    expect(initialsOf('  anna  maria de souza ')).toBe('AS')
    expect(initialsOf('Cher')).toBe('C')
    expect(initialsOf('J. R. Smith')).toBe('JS')
    expect(initialsOf('')).toBe('')
  })
  it('finds the signature categories', () => {
    expect(isSignatureCategory('Signatures')).toBe(true)
    expect(isSignatureCategory('Initials')).toBe(true)
    expect(isSignatureCategory('My stamps')).toBe(false)
  })
  it('lists only fonts that draw differently from the fallback, else a cursive fallback', () => {
    const present = new Set(['"Segoe Script"', '"Ink Free"'])
    const got = installedFonts(TYPED_FONTS, (f) => (present.has(f) ? 120 : 100), 100)
    expect(got.map((f) => f.label)).toEqual(['Segoe Script', 'Ink Free'])
    expect(installedFonts(TYPED_FONTS, () => 100, 100)[0].family).toBe('cursive')
  })
})

describe('inkBounds', () => {
  it('is the box around all strokes', () => {
    expect(inkBounds([[{ x: 5, y: 9, t: 0 }], [{ x: 20, y: 2, t: 1 }]])).toEqual({ x: 5, y: 2, w: 15, h: 7 })
    expect(inkBounds([])).toBeNull()
  })
})
