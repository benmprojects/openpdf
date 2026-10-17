/**
 * Making new PDFs from other things: pictures (one per page), plain text, a screenshot or clipboard image. Pictures
 * the browser can decode (GIF, BMP, WebP) and TIFF are turned into PNG first; PNG and JPEG go in as they are.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import UTIF from 'utif'
import { embeddable } from './textEdit'
import { csvToTable, markdownToText, rtfToText, textKindOf } from './textConvert'

export type PageSizeChoice = 'image' | 'a4' | 'letter'

const A4: [number, number] = [595.28, 841.89]
const LETTER: [number, number] = [612, 792]
/** PDF readers stop at 200 inches; keep clear of it. */
const MAX_PT = 14000

const isPng = (d: Uint8Array) => d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47
const isJpeg = (d: Uint8Array) => d[0] === 0xff && d[1] === 0xd8
const isTiff = (d: Uint8Array) => (d[0] === 0x49 && d[1] === 0x49 && d[2] === 0x2a && d[3] === 0) || (d[0] === 0x4d && d[1] === 0x4d && d[2] === 0 && d[3] === 0x2a)

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('The picture could not be converted.')
  return new Uint8Array(await blob.arrayBuffer())
}

/** PNG or JPEG bytes for any picture we can read. */
export async function normalisePicture(data: Uint8Array): Promise<{ kind: 'png' | 'jpg'; data: Uint8Array }> {
  if (isPng(data)) return { kind: 'png', data }
  if (isJpeg(data)) return { kind: 'jpg', data }
  const canvas = document.createElement('canvas')
  const ctx = () => {
    const c = canvas.getContext('2d')
    if (!c) throw new Error('The picture could not be converted.')
    return c
  }
  if (isTiff(data)) {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    const ifd = UTIF.decode(buf)[0]
    if (!ifd) throw new Error('That TIFF could not be read.')
    UTIF.decodeImage(buf, ifd)
    const px = UTIF.toRGBA8(ifd)
    canvas.width = ifd.width
    canvas.height = ifd.height
    ctx().putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength) as ArrayBuffer), ifd.width, ifd.height), 0, 0)
    return { kind: 'png', data: await canvasToPng(canvas) }
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(data)]))
  } catch (e) {
    throw new Error('That is not a picture this program can read (PNG, JPEG, GIF, BMP, WebP and TIFF are supported).', { cause: e })
  }
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  ctx().drawImage(bitmap, 0, 0)
  bitmap.close()
  return { kind: 'png', data: await canvasToPng(canvas) }
}

/** Page size for a picture: its own size at 96 dpi, or a standard page it is fitted to (turned sideways when it is wide). */
export function pageFor(pixelW: number, pixelH: number, choice: PageSizeChoice, dpi = 96): { page: [number, number]; box: { x: number; y: number; w: number; h: number } } {
  if (choice === 'image') {
    const k = Math.min(72 / dpi, MAX_PT / Math.max(pixelW, pixelH))
    const w = pixelW * k
    const h = pixelH * k
    return { page: [w, h], box: { x: 0, y: 0, w, h } }
  }
  const base = choice === 'a4' ? A4 : LETTER
  const page: [number, number] = pixelW > pixelH ? [base[1], base[0]] : base
  const margin = 18
  const s = Math.min((page[0] - 2 * margin) / pixelW, (page[1] - 2 * margin) / pixelH)
  const w = pixelW * s
  const h = pixelH * s
  return { page, box: { x: (page[0] - w) / 2, y: (page[1] - h) / 2, w, h } }
}

/** A PDF with one picture per page. */
export async function imagesToPdf(images: { name: string; data: Uint8Array }[], choice: PageSizeChoice = 'image', dpi = 96): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const img of images) {
    const pic = await normalisePicture(img.data)
    const embedded = pic.kind === 'png' ? await doc.embedPng(pic.data) : await doc.embedJpg(pic.data)
    const { page, box } = pageFor(embedded.width, embedded.height, choice, dpi)
    doc.addPage(page).drawImage(embedded, { x: box.x, y: box.y, width: box.w, height: box.h })
  }
  return doc.save()
}

export interface TextOptions {
  font: 'Helvetica' | 'Times' | 'Courier'
  size: number
  /** An installed font (TrueType or OpenType file) for characters the standard font cannot show. */
  unicode?: Uint8Array | null
}

const STANDARD: Record<TextOptions['font'], StandardFonts> = { Helvetica: StandardFonts.Helvetica, Times: StandardFonts.TimesRoman, Courier: StandardFonts.Courier }

/** Plain text laid out on A4 pages: wrapped to the width, paginated, tabs as four spaces. */
export async function textToPdf(text: string, o: TextOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\f/g, '\n')
  let font: PDFFont
  if (o.unicode && embeddable(o.unicode, clean)) {
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(o.unicode, { subset: true })
  } else {
    font = await doc.embedFont(STANDARD[o.font])
  }
  const encodes = (s: string) => {
    try {
      font.encodeText(s)
      return true
    } catch {
      return false
    }
  }
  const [pw, ph] = A4
  const margin = 56
  const width = pw - 2 * margin
  const lineHeight = o.size * 1.3
  const lines: string[] = []
  for (const raw of clean.split('\n')) {
    // Characters the font cannot show become '?', so one odd character does not stop the conversion.
    const line = [...raw].map((ch) => (encodes(ch) ? ch : '?')).join('')
    if (!line) {
      lines.push('')
      continue
    }
    let cur = ''
    for (const word of line.split(/( +)/)) {
      if (cur && font.widthOfTextAtSize(cur + word, o.size) > width && word.trim()) {
        lines.push(cur.trimEnd())
        cur = word.trimStart()
      } else cur += word
      // A single word wider than the line is broken wherever it fits.
      while (font.widthOfTextAtSize(cur, o.size) > width && cur.length > 1) {
        let n = cur.length - 1
        while (n > 1 && font.widthOfTextAtSize(cur.slice(0, n), o.size) > width) n--
        lines.push(cur.slice(0, n))
        cur = cur.slice(n)
      }
    }
    lines.push(cur.trimEnd())
  }
  const perPage = Math.max(1, Math.floor((ph - 2 * margin) / lineHeight))
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) {
    const page = doc.addPage(A4)
    lines.slice(i, i + perPage).forEach((l, k) => {
      if (l) page.drawText(l, { x: margin, y: ph - margin - o.size - k * lineHeight, size: o.size, font, color: rgb(0, 0, 0) })
    })
  }
  return doc.save()
}

/** Text of a file's bytes: UTF-8 (with or without a byte order mark) or UTF-16 with one. */
export function decodeTextFile(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2))
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2))
  return new TextDecoder('utf-8').decode(data)
}

/**
 * A PDF from a text-like file: plain text as it is, RTF and Markdown read as plain text (styling is not carried
 * over), CSV as an aligned table in Courier with the size reduced to fit the page width.
 */
export async function textFileToPdf(name: string, data: Uint8Array, o: TextOptions, findUnicode: () => Promise<Uint8Array | null | undefined> = async () => null): Promise<Uint8Array> {
  const kind = textKindOf(name)
  const raw = decodeTextFile(data)
  let text = raw
  let opts = o
  if (kind === 'rtf') text = rtfToText(raw)
  else if (kind === 'md') text = markdownToText(raw)
  else if (kind === 'csv') {
    const t = csvToTable(raw, { fitWidth: A4[0] - 2 * 56, size: o.size })
    text = t.text
    opts = { ...o, font: 'Courier', size: t.size }
  }
  const wide = [...text].some((ch) => ch.charCodeAt(0) > 0xff)
  return textToPdf(text, { ...opts, unicode: wide ? await findUnicode() : null })
}
