import { describe, expect, it } from 'vitest'
import { srgbIccProfile } from './iccProfile'

describe('srgbIccProfile', () => {
  const p = srgbIccProfile(new Date('2026-10-15T09:00:00Z'))
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength)
  const sig = (at: number) => String.fromCharCode(p[at], p[at + 1], p[at + 2], p[at + 3])

  it('has a valid header', () => {
    expect(dv.getUint32(0)).toBe(p.length)
    expect(p.length % 4).toBe(0)
    expect(dv.getUint32(8)).toBe(0x02100000)
    expect([sig(12), sig(16), sig(20), sig(36)]).toEqual(['mntr', 'RGB ', 'XYZ ', 'acsp'])
    expect(dv.getUint16(24)).toBe(2026)
    expect(dv.getUint16(26)).toBe(10)
  })

  it('lists its tags with offsets and sizes that fit inside the file', () => {
    const n = dv.getUint32(128)
    expect(n).toBe(9)
    const names: string[] = []
    for (let i = 0; i < n; i++) {
      const at = 132 + i * 12
      const off = dv.getUint32(at + 4)
      const size = dv.getUint32(at + 8)
      names.push(sig(at))
      expect(off % 4).toBe(0)
      expect(off + size).toBeLessThanOrEqual(p.length)
    }
    expect(names).toEqual(['cprt', 'desc', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC'])
  })

  it('has the sRGB white point and a tone curve that runs from 0 to 1', () => {
    const at = (name: string) => {
      for (let i = 0; i < 9; i++) if (sig(132 + i * 12) === name) return dv.getUint32(132 + i * 12 + 4)
      throw new Error(name)
    }
    const w = at('wtpt')
    expect(dv.getInt32(w + 8) / 65536).toBeCloseTo(0.9642, 3)
    const c = at('rTRC')
    expect(sig(c)).toBe('curv')
    expect(dv.getUint32(c + 8)).toBe(1024)
    expect(dv.getUint16(c + 12)).toBe(0)
    expect(dv.getUint16(c + 12 + 2 * 1023)).toBe(65535)
    // The sRGB curve is below the straight line in the middle (mid-grey 0.5 is about 0.214 in linear light).
    expect(dv.getUint16(c + 12 + 2 * 511) / 65535).toBeCloseTo(0.214, 2)
  })
})
