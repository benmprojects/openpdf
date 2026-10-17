import { PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { ocrDocument, removeScanImages } from './ocrLayer'
import { pageContent } from './pageContent'

// A 2 x 2 white PNG.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8//8/AxJgwOcBAC3sCAWSlq4UAAAAAElFTkSuQmCC', 'base64'))

async function scan(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const img = await doc.embedPng(PNG)
  const page = doc.addPage([200, 300])
  page.drawImage(img, { x: 0, y: 0, width: 200, height: 300 })
  page.drawImage(img, { x: 10, y: 10, width: 20, height: 20 })
  return doc.save()
}

describe('removeScanImages', () => {
  it('takes out page-sized pictures and keeps small ones', async () => {
    const r = await removeScanImages(await scan(), [0])
    expect(r.removed).toBe(1)
    const doc = await PDFDocument.load(r.bytes)
    expect((pageContent(doc.getPage(0)).match(/ Do/g) ?? []).length).toBe(1)
    expect(doc.getPage(0).node.Resources()!.has(PDFName.of('XObject'))).toBe(true)
  })
})

describe('ocrDocument output', () => {
  it('writes visible text and removes the scan in replace mode, and reports tables', async () => {
    const bytes = await scan()
    const w = (text: string, x0: number, y0: number) => ({ text, x0, y0, x1: x0 + 60, y1: y0 + 12, confidence: 90 })
    const line = (y: number) => ({ words: [w('a', 50, y), w('b', 250, y), w('c', 450, y)], baseline: { x0: 50, y0: y + 12, x1: 510, y1: y + 12 } })
    const lines = [line(100), line(120), line(140), line(160)]
    const out = await ocrDocument(
      bytes,
      { languages: ['eng'], dpi: 72, scope: 'all', output: 'replace' },
      {
        client: { render: async (_p, s) => ({ width: Math.round(200 * s), height: Math.round(300 * s), data: new Uint8Array(4) }), pageText: async () => ({ text: '' }) },
        pages: [{ width: 200, height: 300 }],
        recognise: async () => ({ lines, confidence: 88 }),
        findFont: async () => null,
        toPng: async () => new Uint8Array(1)
      }
    )
    expect(out.imagesRemoved).toBe(1)
    expect(out.tables).toHaveLength(1)
    const src = pageContent((await PDFDocument.load(out.bytes)).getPage(0))
    expect(src).toContain('0 Tr')
    expect(src).not.toContain('3 Tr')
  })
})
