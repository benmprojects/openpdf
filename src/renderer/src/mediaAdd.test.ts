import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { findMedia } from './media'
import { addMedia, checkMediaFile, defaultSize } from './mediaAdd'

const blank = async (rotate = 0) => {
  const doc = await PDFDocument.create()
  const p = doc.addPage([400, 300])
  if (rotate) p.setRotation({ type: 'degrees' as never, angle: rotate } as never)
  return doc.save()
}

describe('checkMediaFile', () => {
  it('accepts known audio and video and says why not otherwise', () => {
    expect(checkMediaFile({ name: 'clip.MP4', data: Uint8Array.of(1) })).toMatchObject({ ok: true, kind: 'video', mime: 'video/mp4' })
    expect(checkMediaFile({ name: 'a.wav', data: Uint8Array.of(1) })).toMatchObject({ ok: true, kind: 'audio' })
    expect(checkMediaFile({ name: 'a.txt', data: Uint8Array.of(1) })).toMatchObject({ ok: false })
    expect(checkMediaFile({ name: 'a.mp3', data: new Uint8Array() })).toMatchObject({ ok: false })
  })
})

describe('addMedia', () => {
  it('writes a Screen annotation that the Media pane reads back', async () => {
    const data = Uint8Array.from({ length: 500 }, (_, i) => i % 251)
    const out = await addMedia(await blank(), 0, { x: 200, y: 150 }, { name: 'Site walk.mp4', data })
    const items = await findMedia(out)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'video', page: 0, name: 'Site walk.mp4', mime: 'video/mp4', playable: true })
    expect([...items[0].read()]).toEqual([...data])
    const annots = (await PDFDocument.load(out)).getPage(0).node.Annots()!
    expect(annots.size()).toBe(1)
  })
  it('centres the box on the point and keeps it on the page', async () => {
    const rectOf = async (cx: number, cy: number) => {
      const out = await addMedia(await blank(), 0, { x: cx, y: cy }, { name: 's.mp3', data: Uint8Array.of(1, 2, 3) })
      const annot = (await PDFDocument.load(out)).getPage(0).node.Annots()!.lookup(0, PDFDict)
      return annot.lookup(PDFName.of('Rect'), PDFArray).asRectangle()
    }
    const mid = await rectOf(200, 150)
    expect(mid.width).toBe(defaultSize('audio').w)
    expect(mid.x + mid.width / 2).toBeCloseTo(200)
    // Display y runs down; the PDF rectangle is measured up from the bottom.
    expect(mid.y + mid.height / 2).toBeCloseTo(150)
    const corner = await rectOf(5, 5)
    expect(corner.x).toBe(0)
    expect(corner.y + corner.height).toBeCloseTo(300)
  })
  it('works on a rotated page', async () => {
    const out = await addMedia(await blank(90), 0, { x: 100, y: 100 }, { name: 'v.webm', data: Uint8Array.of(9, 9) })
    expect((await findMedia(out))[0].name).toBe('v.webm')
  })
  it('refuses an unknown file', async () => {
    await expect(addMedia(await blank(), 0, { x: 1, y: 1 }, { name: 'a.exe', data: Uint8Array.of(1) })).rejects.toThrow(/not a video or sound/)
  })
})
