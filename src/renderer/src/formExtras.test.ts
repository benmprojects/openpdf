import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { placeBarcodes } from './barcodeWrite'
import { duplicateSpecs, duplicateTargets } from './formArrange'
import { addFields, placeWidgets, updateField } from './formDesign'
import { dataUrlToImage, imageFieldAction, imageToDataUrl, isImageField, sniffImage } from './formImage'
import { applyFormValues, readForm } from './forms'

async function blank(rotation = 0, pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([300, 400])
    if (rotation) p.setRotation({ type: 'degrees' as never, angle: rotation } as never)
  }
  return doc.save()
}

const JPEG_8X8 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k='
const RED_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function streamText(s: unknown): string {
  return s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : ''
}

/** The appearance stream (normal state) of the first widget of the named field. */
async function appearanceOf(bytes: Uint8Array, name: string): Promise<{ text: string; dict: PDFDict }> {
  const doc = await PDFDocument.load(bytes)
  const w = doc.getForm().getField(name).acroField.getWidgets()[0]
  const ap = w.dict.lookup(PDFName.of('AP'), PDFDict)
  const n = ap.lookup(PDFName.of('N'))
  return { text: streamText(n), dict: (n as PDFRawStream).dict }
}

describe('barcode fields', () => {
  it('draws the value as a barcode, keeps it as text, and redraws it when the value changes', async () => {
    const start = await addFields(await blank(), [{ type: 'text', name: 'ref', page: 0, rect: { x: 20, y: 20, w: 120, h: 40 }, value: '12345678', barcode: { kind: 'code128', ecc: 'M', showText: true } }])
    const [f] = await readForm(start)
    expect(f.barcode).toEqual({ kind: 'code128', ecc: 'M', showText: true })
    expect(f.value).toBe('12345678')
    const a = await appearanceOf(start, 'ref')
    expect(a.text).toMatch(/ re/)
    expect(a.text).toMatch(/Tj/)
    const next = await applyFormValues(start, new Map([['ref', 'ABC-9']]))
    const b = await appearanceOf(next, 'ref')
    expect(b.text).not.toBe(a.text)
    const [g] = await readForm(next)
    expect(g.value).toBe('ABC-9')
    expect(g.barcode?.kind).toBe('code128')
  })

  it('leaves the widget empty (and keeps the text) when the value does not suit the symbology', async () => {
    const start = await addFields(await blank(), [{ type: 'text', name: 'ean', page: 0, rect: { x: 20, y: 20, w: 120, h: 40 }, barcode: { kind: 'ean13', ecc: 'M', showText: true } }])
    const next = await applyFormValues(start, new Map([['ean', 'not digits']]))
    expect((await readForm(next))[0].value).toBe('not digits')
    expect((await appearanceOf(next, 'ean')).text).toBe('')
  })

  it('keeps the barcode when the field moves', async () => {
    const start = await addFields(await blank(), [{ type: 'text', name: 'qr', page: 0, rect: { x: 20, y: 20, w: 60, h: 60 }, value: 'HELLO', barcode: { kind: 'qr', ecc: 'M', showText: false } }])
    const moved = await placeWidgets(start, [{ name: 'qr', widget: 0, rect: { x: 100, y: 100, w: 80, h: 80 } }])
    const [f] = await readForm(moved)
    expect(f.widgets[0].rect).toEqual({ x: 100, y: 100, w: 80, h: 80 })
    expect((await appearanceOf(moved, 'qr')).text).toMatch(/ re/)
  })

  it('works on a rotated page: the form carries the turn', async () => {
    const start = await addFields(await blank(90), [{ type: 'text', name: 'qr', page: 0, rect: { x: 20, y: 20, w: 60, h: 40 }, value: 'HELLO', barcode: { kind: 'qr', ecc: 'M', showText: false } }])
    const a = await appearanceOf(start, 'qr')
    const m = a.dict.lookup(PDFName.of('Matrix'), PDFArray)
    expect(m.size()).toBe(6)
    const bbox = a.dict.lookup(PDFName.of('BBox'), PDFArray)
    // Authored in display space: 60 wide and 40 high as shown.
    expect([bbox.get(2).toString(), bbox.get(3).toString()]).toEqual(['60', '40'])
  })
})

describe('image fields', () => {
  it('is a button with the import-icon script, and fills with the chosen picture', async () => {
    const start = await addFields(await blank(), [{ type: 'button', name: 'photo', page: 0, rect: { x: 20, y: 20, w: 100, h: 80 }, caption: 'Add a picture', action: imageFieldAction() }])
    const [f] = await readForm(start)
    expect(isImageField(f)).toBe(true)
    const img = dataUrlToImage(`data:image/png;base64,${RED_PIXEL}`)!
    expect(img.kind).toBe('png')
    const filled = await applyFormValues(start, new Map([['photo', imageToDataUrl(img)]]))
    const a = await appearanceOf(filled, 'photo')
    expect(a.text).toMatch(/\/Img Do/)
    const xo = (a.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict))
    expect(xo.has(PDFName.of('Img'))).toBe(true)
    // Read again, the field still holds the picture it was given.
    expect((await readForm(filled))[0].value).toBe(imageToDataUrl(img))
  })

  it('keeps a JPEG as it came and reads it back', async () => {
    const start = await addFields(await blank(), [{ type: 'button', name: 'photo', page: 0, rect: { x: 20, y: 20, w: 100, h: 80 }, action: imageFieldAction() }])
    const url = `data:image/jpeg;base64,${JPEG_8X8}`
    const filled = await applyFormValues(start, new Map([['photo', url]]))
    expect((await readForm(filled))[0].value).toBe(url)
    expect((await appearanceOf(filled, 'photo')).text).toMatch(/\/Img Do/)
  })

  it('does not treat an ordinary button as an image field', async () => {
    const start = await addFields(await blank(), [{ type: 'button', name: 'go', page: 0, rect: { x: 20, y: 20, w: 100, h: 30 }, action: { kind: 'reset' } }])
    expect(isImageField((await readForm(start))[0])).toBe(false)
  })

  it('recognises PNG and JPEG and nothing else', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))?.kind).toBe('png')
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.kind).toBe('jpg')
    expect(sniffImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull()
    expect(dataUrlToImage('data:text/plain;base64,AAAA')).toBeNull()
  })
})

describe('moving and duplicating fields in the file', () => {
  it('moves several widgets with one write', async () => {
    const start = await addFields(await blank(), [
      { type: 'text', name: 'a', page: 0, rect: { x: 20, y: 20, w: 100, h: 20 } },
      { type: 'text', name: 'b', page: 0, rect: { x: 40, y: 60, w: 100, h: 20 } }
    ])
    const out = await placeWidgets(start, [
      { name: 'a', widget: 0, rect: { x: 40, y: 20, w: 100, h: 20 } },
      { name: 'b', widget: 0, rect: { x: 40, y: 60, w: 160, h: 30 } }
    ])
    const fields = await readForm(out)
    expect(fields.map((f) => f.widgets[0].rect)).toEqual([{ x: 40, y: 20, w: 100, h: 20 }, { x: 40, y: 60, w: 160, h: 30 }])
  })

  it('copies a field onto the other pages with new names', async () => {
    const start = await addFields(await blank(0, 3), [{ type: 'text', name: 'site', page: 0, rect: { x: 20, y: 20, w: 100, h: 20 }, tooltip: 'Site', required: true, align: 1 }])
    const [src] = await readForm(start)
    const specs = duplicateSpecs(src, 0, duplicateTargets({ name: 'site', widget: 0, page: 0, rect: src.widgets[0].rect }, { kind: 'pages', pages: [0, 1, 2] }), ['site'])
    const out = await addFields(start, specs)
    const fields = await readForm(out)
    expect(fields.map((f) => [f.name, f.widgets[0].page])).toEqual([['site', 0], ['site_2', 1], ['site_3', 2]])
    expect(fields[1]).toMatchObject({ tooltip: 'Site', required: true, align: 1 })
    expect(fields[2].widgets[0].rect).toEqual(src.widgets[0].rect)
  })

  it('renames a field', async () => {
    const start = await addFields(await blank(), [{ type: 'text', name: 'old', page: 0, rect: { x: 20, y: 20, w: 100, h: 20 } }])
    const out = await updateField(start, 'old', { name: 'new' })
    expect((await readForm(out)).map((f) => f.name)).toEqual(['new'])
  })
})

describe('placing barcodes', () => {
  it('draws a QR code as page content and a bar code as an annotation', async () => {
    const out = await placeBarcodes(await blank(), [
      { page: 0, rect: { x: 20, y: 20, w: 80, h: 80 }, style: { kind: 'qr', text: 'https://example.org' }, as: 'content' },
      { page: 0, rect: { x: 20, y: 120, w: 150, h: 50 }, style: { kind: 'code128', text: 'A101-2', showText: true }, as: 'annotation' }
    ])
    const doc = await PDFDocument.load(out)
    const page = doc.getPage(0)
    const xobjects = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    expect(xobjects.keys().some((k) => k.decodeText().startsWith('OPBar'))).toBe(true)
    const annots = page.node.Annots()!
    expect(annots.size()).toBe(1)
    const a = annots.lookup(0, PDFDict)
    expect(String(a.lookup(PDFName.of('Subtype')))).toBe('/Stamp')
    const rect = a.lookup(PDFName.of('Rect'), PDFArray).asArray().map((o) => Number(o.toString()))
    // Display y 120 to 170 on a 400-high page is user y 230 to 280.
    expect(rect).toEqual([20, 230, 170, 280])
  })

  it('places an annotation on a rotated page with the right box', async () => {
    const out = await placeBarcodes(await blank(90), [{ page: 0, rect: { x: 10, y: 20, w: 60, h: 30 }, style: { kind: 'qr', text: 'x' }, as: 'annotation' }])
    const doc = await PDFDocument.load(out)
    const a = doc.getPage(0).node.Annots()!.lookup(0, PDFDict)
    const rect = a.lookup(PDFName.of('Rect'), PDFArray).asArray().map((o) => Number(o.toString()))
    // Turned 90 degrees, display x runs up the page and display y along it: the box is 30 wide and 60 high in the file.
    expect(rect[2] - rect[0]).toBe(30)
    expect(rect[3] - rect[1]).toBe(60)
  })

  it('refuses a box that is too small and text that does not suit', async () => {
    await expect(placeBarcodes(await blank(), [{ page: 0, rect: { x: 0, y: 0, w: 2, h: 2 }, style: { kind: 'qr', text: 'x' }, as: 'content' }])).rejects.toThrow(/too small/)
    await expect(placeBarcodes(await blank(), [{ page: 0, rect: { x: 0, y: 0, w: 50, h: 20 }, style: { kind: 'ean13', text: 'abc' }, as: 'content' }])).rejects.toThrow(/EAN-13/)
  })
})
