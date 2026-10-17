/**
 * Optimise: makes a PDF smaller. Images drawn at more detail than a chosen resolution are re-encoded as JPEG
 * here (pdf-lib plus the browser's image decoders); embedded page thumbnails are dropped; then qpdf, in the main
 * process, rewrites the file with object streams, recompressed streams, no unused objects and, if asked,
 * linearised for fast web view.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib'

export interface OptimiseOptions {
  /** Re-encode images above this resolution (pixels per inch at the largest size a page could show them), or null to leave images alone. */
  maxDpi: number | null
  /** JPEG quality, 0 to 1. */
  quality: number
  dropThumbnails: boolean
  objectStreams: boolean
  recompress: boolean
  removeUnusedResources: boolean
  linearise: boolean
}

export interface OptimiseResult {
  bytes: Uint8Array
  images: number
  thumbnails: number
}

const name = (d: PDFDict, key: string) => d.lookupMaybe(PDFName.of(key), PDFName)?.decodeText()

/** The single filter of an image, '' for none, or null for a chain we do not handle. */
export function filterOf(d: PDFDict): string | null {
  const f = d.lookup(PDFName.of('Filter'))
  if (!f) return ''
  if (f instanceof PDFName) return f.decodeText()
  if (f instanceof PDFArray && f.size() === 1) return f.lookupMaybe(0, PDFName)?.decodeText() ?? null
  return null
}

/** Number of colour components for the colour spaces we can re-encode (grey and RGB), else 0. */
function components(d: PDFDict): 1 | 3 | 0 {
  const cs = d.lookup(PDFName.of('ColorSpace'))
  if (cs instanceof PDFName) return cs.decodeText() === 'DeviceRGB' ? 3 : cs.decodeText() === 'DeviceGray' ? 1 : 0
  if (cs instanceof PDFArray && cs.lookupMaybe(0, PDFName)?.decodeText() === 'ICCBased') {
    const n = cs.lookupMaybe(1, PDFRawStream)?.dict.lookupMaybe(PDFName.of('N'), PDFNumber)?.asNumber()
    return n === 3 ? 3 : n === 1 ? 1 : 0
  }
  return 0
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Undoes PNG row prediction (ISO 32000 7.4.4.4, predictors 10 to 15) for 8-bit samples. */
export function unpredictPng(data: Uint8Array, columns: number, bpp: number): Uint8Array | null {
  const row = columns * bpp
  const rows = Math.floor(data.length / (row + 1))
  const out = new Uint8Array(rows * row)
  for (let y = 0; y < rows; y++) {
    const type = data[y * (row + 1)]
    const src = y * (row + 1) + 1
    const at = y * row
    for (let x = 0; x < row; x++) {
      const raw = data[src + x]
      const a = x >= bpp ? out[at + x - bpp] : 0
      const b = y > 0 ? out[at - row + x] : 0
      const c = x >= bpp && y > 0 ? out[at - row + x - bpp] : 0
      let v: number
      if (type === 0) v = raw
      else if (type === 1) v = raw + a
      else if (type === 2) v = raw + b
      else if (type === 3) v = raw + ((a + b) >> 1)
      else if (type === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      } else return null
      out[at + x] = v & 255
    }
  }
  return out
}

/** Decodes an image we can handle to something a canvas can draw, or null. */
export async function decode(stream: PDFRawStream, w: number, h: number): Promise<ImageBitmap | null> {
  const d = stream.dict
  const filter = filterOf(d)
  if (filter === 'DCTDecode') return createImageBitmap(new Blob([stream.contents as BlobPart], { type: 'image/jpeg' }))
  if (filter !== 'FlateDecode' && filter !== '') return null
  const parms = d.lookupMaybe(PDFName.of('DecodeParms'), PDFDict)
  const predictor = filter === 'FlateDecode' ? (parms?.lookupMaybe(PDFName.of('Predictor'), PDFNumber)?.asNumber() ?? 1) : 1
  if (predictor > 1 && predictor < 10) return null // TIFF prediction: rare, left alone
  const n = components(d)
  let raw = filter === 'FlateDecode' ? await inflate(stream.contents) : stream.contents
  if (predictor >= 10) {
    const un = unpredictPng(raw, w, n)
    if (!un) return null
    raw = un
  }
  if (raw.length < w * h * n) return null
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, j = 0; i < w * h; i++, j += n) {
    rgba[i * 4] = raw[j]
    rgba[i * 4 + 1] = raw[n === 3 ? j + 1 : j]
    rgba[i * 4 + 2] = raw[n === 3 ? j + 2 : j]
    rgba[i * 4 + 3] = 255
  }
  return createImageBitmap(new ImageData(rgba, w, h))
}

async function toJpeg(bmp: ImageBitmap, w: number, h: number, quality: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, w, h)
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, w, h)
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer())
}

/** Re-encodes oversized images and drops thumbnails with pdf-lib. */
export async function shrinkImages(bytes: Uint8Array, o: Pick<OptimiseOptions, 'maxDpi' | 'quality' | 'dropThumbnails'> & { recompressAll?: boolean }): Promise<OptimiseResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  let thumbnails = 0
  // The largest number of pixels each image may keep: the longest page side it appears on, at maxDpi.
  const limit = new Map<string, { ref: PDFRef; px: number }>()
  for (const page of doc.getPages()) {
    if (o.dropThumbnails && page.node.has(PDFName.of('Thumb'))) {
      page.node.delete(PDFName.of('Thumb'))
      thumbnails++
    }
    if (o.maxDpi === null && !o.recompressAll) continue
    const { width, height } = page.getSize()
    const px = o.maxDpi === null ? Infinity : (Math.max(width, height) / 72) * o.maxDpi
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    for (const [, v] of xobjects?.entries() ?? []) {
      if (!(v instanceof PDFRef)) continue
      const prev = limit.get(v.toString())
      if (!prev || prev.px < px) limit.set(v.toString(), { ref: v, px })
    }
  }
  let images = 0
  for (const { ref, px } of limit.values()) {
    const stream = ctx.lookup(ref)
    if (!(stream instanceof PDFRawStream)) continue
    const d = stream.dict
    if (name(d, 'Subtype') !== 'Image') continue
    const w = d.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0
    const h = d.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0
    const bpc = d.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber()
    // Masks, decode arrays, colour-key masks and anything but 8-bit grey or RGB stay as they are.
    if (!w || !h || bpc !== 8 || !components(d) || d.has(PDFName.of('ImageMask')) || d.has(PDFName.of('Decode')) || d.has(PDFName.of('Mask'))) continue
    const s = Math.min(1, px / Math.max(w, h))
    if (s > 0.8 && !o.recompressAll) continue
    const nw = Math.max(1, Math.round(w * s))
    const nh = Math.max(1, Math.round(h * s))
    let jpeg: Uint8Array
    try {
      const bmp = await decode(stream, w, h)
      if (!bmp) continue
      jpeg = await toJpeg(bmp, nw, nh, o.quality)
      bmp.close()
    } catch {
      continue // an image the browser cannot decode stays as it is
    }
    if (jpeg.length >= stream.contents.length) continue
    const nd = d.clone(ctx)
    nd.set(PDFName.of('Width'), PDFNumber.of(nw))
    nd.set(PDFName.of('Height'), PDFNumber.of(nh))
    nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
    nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'))
    nd.set(PDFName.of('Length'), PDFNumber.of(jpeg.length))
    nd.delete(PDFName.of('DecodeParms'))
    ctx.assign(ref, PDFRawStream.of(nd, jpeg))
    images++
  }
  return { bytes: images || thumbnails ? await doc.save({ useObjectStreams: false }) : bytes, images, thumbnails }
}

/**
 * Recompress pictures on their own: every 8-bit grey or RGB picture is re-encoded as JPEG at `quality` (and brought
 * down to `maxDpi` when given); a picture is only replaced when the result is smaller. Nothing else in the file is
 * changed. Repeated recompression of the same JPEG loses quality each time.
 */
export async function recompressPictures(bytes: Uint8Array, o: { quality: number; maxDpi: number | null }): Promise<OptimiseResult> {
  return shrinkImages(bytes, { maxDpi: o.maxDpi, quality: o.quality, dropThumbnails: false, recompressAll: true })
}

/** The whole optimisation: images and thumbnails here, then qpdf. */
export async function optimise(bytes: Uint8Array, o: OptimiseOptions): Promise<OptimiseResult> {
  const first = await shrinkImages(bytes, o)
  const out = await window.openpdf.qpdf(first.bytes, o)
  return { ...first, bytes: out }
}
