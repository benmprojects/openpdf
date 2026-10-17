import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { newBlankDocument, newDocumentSize } from './newDocument'

describe('newBlankDocument', () => {
  it('makes the pages asked for at the size asked for', async () => {
    const doc = await PDFDocument.load(await newBlankDocument({ width: 595.28, height: 841.89 }, 3))
    expect(doc.getPageCount()).toBe(3)
    expect(doc.getPage(2).getSize().width).toBeCloseTo(595.28, 1)
  })
  it('refuses silly counts and sizes', async () => {
    await expect(newBlankDocument({ width: 100, height: 100 }, 0)).rejects.toThrow()
    await expect(newBlankDocument({ width: 100, height: 100 }, 501)).rejects.toThrow()
    await expect(newBlankDocument({ width: 2, height: 100 }, 1)).rejects.toThrow()
  })
})

describe('newDocumentSize', () => {
  it('gives A4 portrait and landscape', () => {
    const p = newDocumentSize('a4', 'portrait', { w: 0, h: 0 })
    const l = newDocumentSize('a4', 'landscape', { w: 0, h: 0 })
    expect(Math.round(p.width)).toBe(595)
    expect(Math.round(p.height)).toBe(842)
    expect(Math.round(l.width)).toBe(842)
  })
  it('checks a custom size', () => {
    expect(newDocumentSize('custom', 'portrait', { w: 5, h: 5 }).error).toBeTruthy()
    expect(newDocumentSize('custom', 'portrait', { w: 100, h: 200 }).error).toBeNull()
  })
})
