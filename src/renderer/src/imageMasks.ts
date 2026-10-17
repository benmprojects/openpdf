/**
 * Flattens pictures that have a soft mask (transparency) onto white, for standards that forbid transparency (PDF/A-1,
 * PDF/X-1a). The picture becomes an opaque one in the colour space it had (grey stays grey, RGB or ICC RGB become
 * RGB, CMYK stays CMYK), so anything behind it on the page that the picture let show through is now hidden by white.
 * Pictures it cannot read (other encodings, bit depths) are left alone and counted.
 */
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import { samplesOf, spaceFromObject, type Space } from './colourConvert'
import { imageStreams, replaceStreamData } from './docStreams'

const N = PDFName.of

export async function flattenSoftMasks(doc: PDFDocument): Promise<{ flattened: number; left: number }> {
  let flattened = 0
  let left = 0
  for (const { ref, stream } of imageStreams(doc)) {
    const d = stream.dict
    const maskRef = d.get(N('SMask'))
    if (!maskRef) continue
    const mask = doc.context.lookup(maskRef)
    const w = d.lookupMaybe(N('Width'), PDFNumber)?.asNumber() ?? 0
    const h = d.lookupMaybe(N('Height'), PDFNumber)?.asNumber() ?? 0
    const space: Space | null = spaceFromObject(d.lookup(N('ColorSpace')))
    if (!(mask instanceof PDFRawStream) || !space || !w || !h || d.lookupMaybe(N('BitsPerComponent'), PDFNumber)?.asNumber() !== 8 || d.has(N('Decode')) || d.has(N('Mask'))) {
      left++
      continue
    }
    const mw = mask.dict.lookupMaybe(N('Width'), PDFNumber)?.asNumber() ?? 0
    const mh = mask.dict.lookupMaybe(N('Height'), PDFNumber)?.asNumber() ?? 0
    const mdict: PDFDict = mask.dict
    if (!mw || !mh || mdict.lookupMaybe(N('BitsPerComponent'), PDFNumber)?.asNumber() !== 8 || mdict.has(N('Decode')) || mdict.has(N('Matte'))) {
      left++
      continue
    }
    const colour = await samplesOf(stream, space, w, h).catch(() => null)
    const alpha = await samplesOf(mask, 'gray', mw, mh).catch(() => null)
    if (!colour || !alpha) {
      left++
      continue
    }
    const n = space === 'gray' ? 1 : space === 'rgb' ? 3 : 4
    // White is 255 in grey and RGB and 0 in CMYK.
    const white = space === 'cmyk' ? 0 : 255
    const out = new Uint8Array(w * h * n)
    for (let y = 0; y < h; y++) {
      const my = Math.min(mh - 1, Math.floor((y * mh) / h))
      for (let x = 0; x < w; x++) {
        const a = alpha[my * mw + Math.min(mw - 1, Math.floor((x * mw) / w))] / 255
        const at = (y * w + x) * n
        for (let c = 0; c < n; c++) out[at + c] = Math.round(a * colour[at + c] + (1 - a) * white)
      }
    }
    replaceStreamData(doc, ref, stream, out)
    const fresh = doc.context.lookup(ref) as PDFRawStream
    fresh.dict.delete(N('SMask'))
    fresh.dict.set(N('BitsPerComponent'), PDFNumber.of(8))
    flattened++
  }
  return { flattened, left }
}
