import { PDFDocument, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { parseContent, pathDraws } from './content'
import { pageContent } from './pageContent'
import { transformPath, type PathEditTarget } from './pathEdit'

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  page.drawRectangle({ x: 50, y: 60, width: 100, height: 40, color: rgb(1, 0, 0) })
  page.drawLine({ start: { x: 200, y: 200 }, end: { x: 300, y: 260 }, thickness: 2, color: rgb(0, 0, 1) })
  return doc.save()
}

async function paths(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  return pathDraws(parseContent(pageContent(doc.getPage(0))))
}

const rect: PathEditTarget = { page: 0, ordinal: 0, total: 2, pageBounds: [50, 60, 150, 100] }
const line: PathEditTarget = { page: 0, ordinal: 1, total: 2, pageBounds: [199, 199, 301, 261] }

describe('pathEdit', () => {
  it('finds the page paints in order', async () => {
    const d = await paths(await makePdf())
    expect(d).toHaveLength(2)
    expect(d[0].bbox).toMatchObject({ x0: 50, y0: 60, x1: 150, y1: 100 })
  })

  it('moves one path and leaves the other', async () => {
    const out = await transformPath(await makePdf(), rect, [1, 0, 0, 1, 25, -10])
    const d = await paths(out)
    expect(d).toHaveLength(2)
    expect(d[0].bbox).toMatchObject({ x0: 75, y0: 50, x1: 175, y1: 90 })
    expect(d[1].bbox).toMatchObject({ x0: 200, y0: 200, x1: 300, y1: 260 })
  })

  it('scales a path about a point', async () => {
    // Double the rectangle about its bottom-left corner (50, 60).
    const out = await transformPath(await makePdf(), rect, [2, 0, 0, 2, -50, -60])
    const d = await paths(out)
    expect(d[0].bbox).toMatchObject({ x0: 50, y0: 60, x1: 250, y1: 140 })
  })

  it('deletes a path', async () => {
    const out = await transformPath(await makePdf(), line, null)
    const d = await paths(out)
    expect(d).toHaveLength(1)
    expect(d[0].bbox.x0).toBe(50)
  })

  it('refuses when the count or position does not match PDFium, or when the path clips', async () => {
    await expect(transformPath(await makePdf(), { ...rect, total: 3 }, null)).rejects.toThrow(/cannot be edited safely/)
    await expect(transformPath(await makePdf(), { ...rect, pageBounds: [80, 60, 180, 100] }, null)).rejects.toThrow(/page changed/)
  })
})
