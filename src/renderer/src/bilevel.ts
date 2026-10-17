/**
 * Black and white pictures for scans: pictures that are really text on paper are turned into 1-bit images and stored
 * with CCITT Group 4 compression (ISO 32000 7.4.6), which makes a scanned page a few tens of kilobytes instead of
 * hundreds. This throws away all grey and colour: only use it for text and line drawings. The encoder is
 * ts-ccitt-g4-encoder (MIT). JBIG2 is not offered (no permissive encoder).
 */
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import { encode } from 'ts-ccitt-g4-encoder'
import { samplesOf, spaceFromObject } from './colourConvert'
import { imageStreams } from './docStreams'
import { otsu } from './scanImage'

const N = PDFName.of

/** Grey (0 to 255) from interleaved samples of 1, 3 or 4 components (RGB and CMYK weighted as in colourConvert). */
export function toGreyBytes(raw: Uint8Array, comps: 1 | 3 | 4, count: number): Uint8Array {
  if (comps === 1) return raw.subarray(0, count)
  const g = new Uint8Array(count)
  for (let i = 0, a = 0; i < count; i++, a += comps) {
    if (comps === 3) g[i] = (77 * raw[a] + 151 * raw[a + 1] + 28 * raw[a + 2]) >> 8
    else g[i] = Math.max(0, 255 - Math.min(255, (77 * raw[a] + 151 * raw[a + 1] + 28 * raw[a + 2]) / 256 + raw[a + 3]))
  }
  return g
}

/** Packs grey pixels into bits, MSB first with no padding between rows, one for ink (below the threshold). That is the layout the encoder reads. */
export function packInk(grey: Uint8Array, threshold: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(grey.length / 8))
  for (let i = 0; i < grey.length; i++) if (grey[i] < threshold) out[i >> 3] |= 0x80 >> (i & 7)
  return out
}

/** CCITT Group 4 data for grey pixels: ink below `threshold` (or Otsu's threshold when omitted). */
export function encodeG4(grey: Uint8Array, width: number, height: number, threshold?: number): { data: Uint8Array; threshold: number } {
  const t = threshold ?? Math.min(250, Math.max(32, otsu(grey)))
  return { data: encode(packInk(grey, t), width, height), threshold: t }
}

export interface BilevelResult {
  bytes: Uint8Array
  pictures: number
  left: number
  before: number
  after: number
}

/** Turns the pictures of a document into black and white G4 images. Pictures smaller than `minPixels` (logos, rules) are left alone. */
export async function pictures8ToBilevel(bytes: Uint8Array, o: { threshold?: number; minPixels?: number } = {}): Promise<BilevelResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const res: BilevelResult = { bytes, pictures: 0, left: 0, before: 0, after: 0 }
  for (const { ref, stream } of imageStreams(doc)) {
    const d = stream.dict
    const w = d.lookupMaybe(N('Width'), PDFNumber)?.asNumber() ?? 0
    const h = d.lookupMaybe(N('Height'), PDFNumber)?.asNumber() ?? 0
    const space = spaceFromObject(d.lookup(N('ColorSpace')))
    if (d.lookup(N('ImageMask')) || !w || !h || w * h < (o.minPixels ?? 40_000)) continue
    if (!space || d.lookupMaybe(N('BitsPerComponent'), PDFNumber)?.asNumber() !== 8 || d.has(N('Decode')) || d.has(N('Mask')) || d.has(N('SMask'))) {
      res.left++
      continue
    }
    const raw = await samplesOf(stream, space, w, h).catch(() => null)
    if (!raw) {
      res.left++
      continue
    }
    const grey = toGreyBytes(raw, space === 'gray' ? 1 : space === 'rgb' ? 3 : 4, w * h)
    const { data } = encodeG4(grey, w, h, o.threshold)
    const ctx = doc.context
    const fresh = ctx.stream(data, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: w,
      Height: h,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 1,
      Filter: 'CCITTFaxDecode',
      DecodeParms: { K: -1, Columns: w, Rows: h }
    })
    res.before += stream.contents.length
    res.after += data.length
    ctx.assign(ref, fresh as unknown as PDFRawStream)
    res.pictures++
  }
  res.bytes = res.pictures ? await doc.save() : bytes
  return res
}
