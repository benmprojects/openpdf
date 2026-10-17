import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { writeAnnotations } from './annotWrite'
import { withBounds, type Annot } from './annotations'
import { flattenSignatures } from './flatten'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const stamp = (id: number, page: number, signature: boolean): Annot =>
  withBounds({ id, page, kind: 'stamp', color: '#000000', rects: [{ x: 50, y: 60, w: 120, h: 40 }], text: 'Sig', fontSize: 12, lineWidth: 2, image: PNG, signature: signature || undefined })

async function twoPages(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([595, 842])
  d.addPage([595, 842])
  return d.save()
}

const annotsOf = (doc: PDFDocument, page: number): PDFDict[] => {
  const list = doc.getPage(page).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  return list ? Array.from({ length: list.size() }, (_, i) => list.lookup(i, PDFDict)) : []
}

describe('visual signatures', () => {
  it('are written as image stamps with the subject "Visual signature" and no /Contents', async () => {
    const doc = await PDFDocument.load(await writeAnnotations(await twoPages(), [stamp(1, 0, true), stamp(2, 0, false)]))
    const [sig, pic] = annotsOf(doc, 0)
    expect(sig.lookup(PDFName.of('Subj'), PDFHexString).decodeText()).toBe('Visual signature')
    expect(pic.lookup(PDFName.of('Subj'), PDFHexString).decodeText()).toBe('Image stamp')
    expect(sig.has(PDFName.of('Contents'))).toBe(false)
  })
  it('flatten into the page on every page, leaving other stamps as annotations', async () => {
    const written = await writeAnnotations(await twoPages(), [stamp(1, 0, true), stamp(2, 0, false), stamp(3, 1, true)])
    const r = await flattenSignatures(written)
    expect(r.count).toBe(2)
    const doc = await PDFDocument.load(r.bytes)
    expect(annotsOf(doc, 0)).toHaveLength(1)
    expect(annotsOf(doc, 1)).toHaveLength(0)
  })
  it('does nothing when there are none', async () => {
    const r = await flattenSignatures(await writeAnnotations(await twoPages(), [stamp(1, 0, false)]))
    expect(r.count).toBe(0)
  })
})
