/**
 * Image fields: a push button that lets whoever fills the form choose a picture, which then fills the button (the
 * way Acrobat's "Image Field" works, through the standard buttonImportIcon call).
 */
import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFButton } from 'pdf-lib'
import { frameFor } from './annotWrite'
import type { ButtonAction, FormField } from './forms'
import type { Matrix6 } from './content'

/** The script an image field's button runs; the standard Acrobat call. */
export const IMAGE_FIELD_SCRIPT = 'event.target.buttonImportIcon();'

export const imageFieldAction = (): ButtonAction => ({ kind: 'javascript', code: IMAGE_FIELD_SCRIPT })

export const isImageField = (f: Pick<FormField, 'type' | 'action'>): boolean => f.type === 'button' && f.action?.kind === 'javascript' && /buttonImportIcon\s*\(/.test(f.action.code)

export interface PickedImage {
  data: Uint8Array
  kind: 'png' | 'jpg'
}

/** PNG or JPEG by the file's first bytes, or null for anything else. */
export function sniffImage(data: Uint8Array): PickedImage | null {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return { data, kind: 'png' }
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { data, kind: 'jpg' }
  return null
}

export function imageToDataUrl(img: PickedImage): string {
  let bin = ''
  for (let i = 0; i < img.data.length; i += 8192) bin += String.fromCharCode(...img.data.subarray(i, i + 8192))
  return `data:image/${img.kind === 'png' ? 'png' : 'jpeg'};base64,${btoa(bin)}`
}

export function dataUrlToImage(url: string): PickedImage | null {
  const m = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(url)
  if (!m) return null
  const bin = atob(m[2])
  const data = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
  return { data, kind: m[1] === 'png' ? 'png' : 'jpg' }
}

/** The picture an image field was given, as a data URL (read from the copy kept in the field), or '' when it has none. */
export function storedImageValue(dict: PDFDict): string {
  const o = dict.lookup(PDFName.of('OpenPDFImage'))
  const img = o instanceof PDFRawStream ? sniffImage(o.contents) : null
  return img ? imageToDataUrl(img) : ''
}

/** Makes the picture the button's appearance, fitted inside each widget with its proportions kept. */
export async function setButtonImage(doc: PDFDocument, field: PDFButton, image: PickedImage): Promise<void> {
  const pic = image.kind === 'png' ? await doc.embedPng(image.data) : await doc.embedJpg(image.data)
  // The picture is kept as it came (a JPEG is the very stream drawn), so the form shows it again when it is opened.
  const kept = image.kind === 'jpg' ? pic.ref : doc.context.register(doc.context.stream(image.data))
  field.acroField.dict.set(PDFName.of('OpenPDFImage'), kept)
  for (const w of field.acroField.getWidgets()) {
    const r = w.getRectangle()
    const page = doc.getPages().find((p) => p.ref === w.P()) ?? doc.getPages().find((p) => p.node.Annots()?.asArray().some((a) => doc.context.lookup(a) === w.dict))
    const angle = page ? page.getRotation().angle : 0
    const sideways = angle % 180 !== 0
    const bw = sideways ? r.height : r.width
    const bh = sideways ? r.width : r.height
    const cb = page?.getCropBox()
    const f = (cb ? frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, angle).m : [1, 0, 0, -1, 0, 0]) as Matrix6
    const scale = Math.min(bw / pic.width, bh / pic.height)
    const iw = pic.width * scale
    const ih = pic.height * scale
    const ox = (bw - iw) / 2
    const oy = (bh - ih) / 2
    const ops = `q ${iw.toFixed(3)} 0 0 ${(-ih).toFixed(3)} ${ox.toFixed(3)} ${(oy + ih).toFixed(3)} cm /Img Do Q`
    const form = doc.context.register(doc.context.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, bw, bh], Matrix: [f[0], f[1], f[2], f[3], 0, 0], Resources: { XObject: { Img: pic.ref } } } as never))
    w.dict.set(PDFName.of('AP'), doc.context.obj({ N: form }))
  }
}

/** Takes the picture out of an image field: the stored copy and the appearance go, and the caption is drawn again. */
export async function clearButtonImage(doc: PDFDocument, field: PDFButton): Promise<void> {
  field.acroField.dict.delete(PDFName.of('OpenPDFImage'))
  for (const w of field.acroField.getWidgets()) w.dict.delete(PDFName.of('AP'))
  field.updateAppearances(await doc.embedFont(StandardFonts.Helvetica))
}
