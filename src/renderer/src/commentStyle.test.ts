import { describe, expect, it } from 'vitest'
import { blendOf, cloudLevel, isLocked, isPrintable, lineEndsOf, withBounds, withFlag, FLAG_LOCKED, FLAG_PRINT, type Annot, type AnnotKind } from './annotations'
import { applyStyle, cleanStyle, styleOf } from './commentStyle'
import { endShape, pathEnds } from './lineEnds'

const make = (kind: AnnotKind, extra: Partial<Annot> = {}): Annot =>
  withBounds({ id: 1, page: 0, kind, color: '#e5322d', rects: [{ x: 10, y: 10, w: 200, h: 100 }], text: '', fontSize: 12, lineWidth: 2, ...extra })

describe('comment styles', () => {
  it('takes the look of a cloud and gives it to a rectangle without line ends', () => {
    const cloud = make('cloud', { points: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]], color: '#1f5fd1', fill: '#fff4c2', lineWidth: 4, cloud: 2, dash: 'dashed' })
    const style = styleOf(cloud)
    expect(style).toMatchObject({ color: '#1f5fd1', fill: '#fff4c2', lineWidth: 4, cloud: 2, dash: 'dashed' })
    const rect = applyStyle(make('rectangle'), style)
    expect(rect).toMatchObject({ color: '#1f5fd1', fill: '#fff4c2', lineWidth: 4, cloud: 2, dash: 'dashed' })
    expect(rect.lineStart).toBeUndefined()
  })
  it('gives line ends only to lines, arrows and polylines, and refits their box', () => {
    const style = { color: '#000000', lineStart: 'Circle' as const, lineEnd: 'ClosedArrow' as const, lineWidth: 2 }
    const line = applyStyle(make('line', { points: [[{ x: 50, y: 50 }, { x: 150, y: 50 }]] }), style)
    expect(lineEndsOf(line)).toEqual({ start: 'Circle', end: 'ClosedArrow' })
    expect(line.rects[0].h).toBeGreaterThan(2)
    expect(applyStyle(make('note'), style).lineEnd).toBeUndefined()
  })
  it('clears what a saved style leaves out when it replaces, and keeps it otherwise', () => {
    const a = make('rectangle', { fill: '#ff0000', opacity: 0.5, blend: 'Multiply' })
    const replaced = applyStyle(a, { color: '#00ff00' })
    expect(replaced.fill).toBeUndefined()
    expect(replaced.opacity).toBeUndefined()
    expect(replaced.blend).toBeUndefined()
    const kept = applyStyle(a, { color: '#00ff00' }, false)
    expect(kept).toMatchObject({ fill: '#ff0000', opacity: 0.5, blend: 'Multiply' })
  })
  it('gives text kinds a font and refits a typewriter', () => {
    const t = applyStyle(make('typewriter', { text: 'Hello', rects: [{ x: 10, y: 10, w: 30, h: 16 }] }), { color: '#000000', fontFamily: 'Courier', fontSize: 24 })
    expect(t).toMatchObject({ fontFamily: 'Courier', fontSize: 24 })
    expect(t.rects[0].h).toBeGreaterThan(24)
  })
  it('drops empty entries from a saved style', () => {
    expect(cleanStyle({ color: '#000000', fill: undefined, lineWidth: 2 })).toEqual({ color: '#000000', lineWidth: 2 })
  })
})

describe('defaults', () => {
  it('an arrow ends in an open arrow, a highlight multiplies, a cloud is intensity 1', () => {
    expect(lineEndsOf({ kind: 'arrow' })).toEqual({ start: 'None', end: 'OpenArrow' })
    expect(lineEndsOf({ kind: 'line' })).toEqual({ start: 'None', end: 'None' })
    expect(lineEndsOf({ kind: 'arrow', lineEnd: 'None' }).end).toBe('None')
    expect(blendOf({ kind: 'highlight' })).toBe('Multiply')
    expect(blendOf({ kind: 'rectangle' })).toBe('Normal')
    expect(cloudLevel({ kind: 'cloud' })).toBe(1)
    expect(cloudLevel({ kind: 'cloud', cloud: 0 })).toBe(0)
    expect(cloudLevel({ kind: 'polygon' })).toBe(0)
    expect(cloudLevel({ kind: 'ink', cloud: 2 })).toBe(0)
  })
})

describe('flags', () => {
  it('a new annotation prints and is not locked', () => {
    expect(isPrintable({})).toBe(true)
    expect(isLocked({})).toBe(false)
  })
  it('switches bits on and off without touching the others', () => {
    const a = withFlag({ flags: 4 | 8 }, FLAG_LOCKED, true)
    expect(a.flags).toBe(4 | 8 | 128)
    expect(isLocked(a)).toBe(true)
    const b = withFlag(a, FLAG_PRINT, false)
    expect(isPrintable(b)).toBe(false)
    expect(b.flags).toBe(8 | 128)
    expect(isLocked(withFlag(b, FLAG_LOCKED, false))).toBe(false)
  })
  it('an annotation with flags 0 (from a file) does not print', () => {
    expect(isPrintable({ flags: 0 })).toBe(false)
  })
})

describe('end shapes', () => {
  const tip = { x: 100, y: 0 }
  const from = { x: 0, y: 0 }
  it('draws nothing for none, and open or closed triangles for arrows', () => {
    expect(endShape('None', tip, from, 2)).toEqual([])
    const open = endShape('OpenArrow', tip, from, 2)[0]
    const closed = endShape('ClosedArrow', tip, from, 2)[0]
    expect(open).toMatchObject({ closed: false, fill: false })
    expect(closed).toMatchObject({ closed: true, fill: true })
    expect(open.pts[1]).toEqual(tip)
    expect(open.pts[0].x).toBeLessThan(tip.x)
  })
  it('centres circles, squares and diamonds on the end, and puts slash and butt across it', () => {
    for (const style of ['Circle', 'Square', 'Diamond'] as const) {
      const p = endShape(style, tip, from, 2)[0]
      expect(p.closed).toBe(true)
      const cx = p.pts.reduce((s, q) => s + q.x, 0) / p.pts.length
      const cy = p.pts.reduce((s, q) => s + q.y, 0) / p.pts.length
      expect(cx).toBeCloseTo(100, 5)
      expect(cy).toBeCloseTo(0, 5)
    }
    const butt = endShape('Butt', tip, from, 2)[0]
    expect(butt.pts.map((q) => q.x)).toEqual([100, 100])
    const slash = endShape('Slash', tip, from, 2)[0]
    expect(slash.pts[0].x).not.toBeCloseTo(slash.pts[1].x, 3)
  })
  it('the start marker looks back along the first segment', () => {
    const marks = pathEnds([{ x: 0, y: 0 }, { x: 100, y: 0 }], 'ClosedArrow', 'None', 2)
    expect(marks).toHaveLength(1)
    expect(marks[0].pts[1]).toEqual({ x: 0, y: 0 })
    expect(marks[0].pts[0].x).toBeGreaterThan(0)
  })
})
