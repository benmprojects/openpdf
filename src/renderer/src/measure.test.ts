import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { calibrate, distance, formatArea, formatLength, PAPER_MM, pathLength, polygonArea, readViewports, scaleAt } from './measure'

describe('geometry', () => {
  it('measures distances, paths and areas', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(pathLength(square)).toBe(30)
    expect(pathLength(square, true)).toBe(40)
    expect(polygonArea(square)).toBe(100)
    expect(polygonArea([...square].reverse())).toBe(100)
  })
})

describe('scales', () => {
  it('formats paper millimetres', () => {
    expect(formatLength(72, PAPER_MM)).toBe('25.4 mm')
    expect(formatArea(72 * 72, PAPER_MM)).toBe('645.2 mm²')
  })
  it('calibrates from a known length', () => {
    const s = calibrate(144, 10, 'm')
    expect(formatLength(72, s)).toBe('5 m')
    expect(() => calibrate(0, 5, 'm')).toThrow()
  })
  it('picks the smallest viewport holding the point, unless calibrated', () => {
    const big = { bbox: [0, 0, 600, 800] as [number, number, number, number], scale: { factor: 1, unit: 'm', source: 'document' as const } }
    const small = { bbox: [100, 100, 200, 200] as [number, number, number, number], scale: { factor: 2, unit: 'm', source: 'document' as const } }
    expect(scaleAt({ x: 150, y: 150 }, [big, small], null).factor).toBe(2)
    expect(scaleAt({ x: 50, y: 50 }, [big, small], null).factor).toBe(1)
    expect(scaleAt({ x: 900, y: 900 }, [big, small], null)).toBe(PAPER_MM)
    expect(scaleAt({ x: 150, y: 150 }, [big, small], calibrate(1, 1, 'ft')).unit).toBe('ft')
  })
})

describe('readViewports', () => {
  it('reads a rectilinear measure dictionary and flips the box to top-left coordinates', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const ctx = doc.context
    const measure = ctx.obj({ Type: 'Measure', Subtype: 'RL', R: PDFString.of('1:100'), X: [ctx.obj({ Type: 'NumberFormat', U: PDFString.of('m'), C: 0.035 })] })
    page.node.set(PDFName.of('VP'), ctx.obj([ctx.obj({ Type: 'Viewport', BBox: [50, 100, 550, 700], Measure: measure })]))
    const vps = await readViewports(await doc.save())
    expect(vps).toHaveLength(1)
    expect(vps[0]).toHaveLength(1)
    expect(vps[0][0].bbox).toEqual([50, 100, 550, 700])
    expect(vps[0][0].scale).toMatchObject({ factor: 0.035, unit: 'm', label: '1:100', source: 'document' })
  })
})
