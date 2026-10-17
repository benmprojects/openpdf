/**
 * Convert colours: rewrites the device colours in a document to grey, CMYK or RGB. This is an approximate DEVICE
 * conversion with simple formulas (grey from the usual 0.30, 0.59, 0.11 weights; CMYK from RGB with full black
 * generation; RGB from CMYK without a colour profile). It is not colour managed: results will differ from a press
 * profile or a colour-managed viewer. What is converted: colour operators in page contents, forms, patterns and
 * annotation appearances; 8-bit pictures in grey, RGB or CMYK (Flate or uncompressed; JPEG RGB and grey through the
 * browser's decoder). What is left alone and reported: spot colours, DeviceN, Lab, shadings, inline pictures, pictures
 * with masks or other encodings.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFObject } from 'pdf-lib'
import { num, parseContent, type Op } from './content'
import { contentScopes, imageStreams, replaceStreamData } from './docStreams'
import { decode, filterOf, inflate, unpredictPng } from './optimise'

export type ColourMode = 'gray' | 'cmyk' | 'rgb'
export type Space = 'gray' | 'rgb' | 'cmyk'

const clamp = (v: number) => Math.min(1, Math.max(0, v))

export function toGray(space: Space, v: number[]): number {
  if (space === 'gray') return clamp(v[0])
  if (space === 'rgb') return clamp(0.3 * v[0] + 0.59 * v[1] + 0.11 * v[2])
  return clamp(1 - Math.min(1, 0.3 * v[0] + 0.59 * v[1] + 0.11 * v[2] + v[3]))
}

export function toRgb(space: Space, v: number[]): [number, number, number] {
  if (space === 'gray') return [clamp(v[0]), clamp(v[0]), clamp(v[0])]
  if (space === 'rgb') return [clamp(v[0]), clamp(v[1]), clamp(v[2])]
  const k = 1 - clamp(v[3])
  return [(1 - clamp(v[0])) * k, (1 - clamp(v[1])) * k, (1 - clamp(v[2])) * k]
}

export function toCmyk(space: Space, v: number[]): [number, number, number, number] {
  if (space === 'cmyk') return [clamp(v[0]), clamp(v[1]), clamp(v[2]), clamp(v[3])]
  const [r, g, b] = toRgb(space, v)
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return [0, 0, 0, 1]
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]
}

/** Converts a colour to `mode`, as the numbers to write. */
export function convertValue(from: Space, to: ColourMode, v: number[]): number[] {
  return to === 'gray' ? [toGray(from, v)] : to === 'rgb' ? toRgb(from, v) : toCmyk(from, v)
}

const SETTERS: Record<ColourMode, string[]> = { gray: ['g', 'G'], rgb: ['rg', 'RG'], cmyk: ['k', 'K'] }
const DEVICE: Record<ColourMode, string> = { gray: 'DeviceGray', rgb: 'DeviceRGB', cmyk: 'DeviceCMYK' }

const OWN_SPACE: Record<string, Space> = { g: 'gray', G: 'gray', rg: 'rgb', RG: 'rgb', k: 'cmyk', K: 'cmyk' }
const DEVICE_SPACE: Record<string, Space> = { DeviceGray: 'gray', G: 'gray', DeviceRGB: 'rgb', RGB: 'rgb', DeviceCMYK: 'cmyk', CMYK: 'cmyk', CalGray: 'gray', CalRGB: 'rgb' }

export interface ContentResult {
  src: string
  /** Colour operators rewritten. */
  changed: number
  /** Colours left alone: spot colours, patterns, shadings and the like. */
  spot: number
  shadings: number
  inlineImages: number
}

/**
 * Rewrites the colour operators of one content stream. `spaceOf` says what a named colour space (from the resources)
 * is: grey, RGB or CMYK (ICC based or calibrated spaces count as the device space with that many components), or null
 * when it cannot be converted (Separation, DeviceN, Lab, Indexed, Pattern).
 */
export function convertContent(src: string, to: ColourMode, spaceOf: (name: string) => Space | null): ContentResult {
  const ops = parseContent(src)
  type State = { fill: Space | null; stroke: Space | null }
  let st: State = { fill: 'gray', stroke: 'gray' }
  const stack: State[] = []
  const edits: { op: Op; text: string }[] = []
  let spot = 0
  let shadings = 0
  let inlineImages = 0
  const resolve = (name: string): Space | null => DEVICE_SPACE[name] ?? (name === 'Pattern' ? null : spaceOf(name))
  const numbers = (o: Op) => o.operands.filter((t): t is { t: 'num'; v: number } => t.t === 'num').map((t) => t.v)
  for (const o of ops) {
    const stroke = o.op === 'G' || o.op === 'RG' || o.op === 'K' || o.op === 'SC' || o.op === 'SCN' || o.op === 'CS'
    switch (o.op) {
      case 'q':
        stack.push({ ...st })
        break
      case 'Q':
        st = stack.pop() ?? st
        break
      case 'g':
      case 'G':
      case 'rg':
      case 'RG':
      case 'k':
      case 'K': {
        const from = OWN_SPACE[o.op]
        st[stroke ? 'stroke' : 'fill'] = from
        const v = numbers(o)
        if (from !== to && v.length === (from === 'gray' ? 1 : from === 'rgb' ? 3 : 4)) edits.push({ op: o, text: `${convertValue(from, to, v).map(num).join(' ')} ${SETTERS[to][stroke ? 1 : 0]}` })
        break
      }
      case 'cs':
      case 'CS': {
        const name = o.operands[0]?.t === 'name' ? o.operands[0].v : ''
        const space = resolve(name)
        st[stroke ? 'stroke' : 'fill'] = space
        if (space === null) spot++
        else if (space !== to) edits.push({ op: o, text: `/${DEVICE[to]} ${o.op}` })
        break
      }
      case 'sc':
      case 'scn':
      case 'SC':
      case 'SCN': {
        const from = st[stroke ? 'stroke' : 'fill']
        const nums = numbers(o)
        if (o.operands.some((t) => t.t === 'name')) {
          spot++
          break
        }
        if (!from || from === to) break
        if (nums.length === (from === 'gray' ? 1 : from === 'rgb' ? 3 : 4)) edits.push({ op: o, text: `${convertValue(from, to, nums).map(num).join(' ')} ${o.op}` })
        break
      }
      case 'sh':
        shadings++
        break
      case 'BI':
        inlineImages++
        break
    }
  }
  let out = ''
  let at = 0
  for (const e of edits) {
    out += src.slice(at, e.op.start) + e.text
    at = e.op.end
  }
  out += src.slice(at)
  return { src: out, changed: edits.length, spot, shadings, inlineImages }
}

// ---- Pictures --------------------------------------------------------------------------------------

/** The colour space of an image or colour-space resource as grey, RGB or CMYK; null for anything else (Indexed, Separation, Lab...). */
export function spaceFromObject(obj: PDFObject | undefined): Space | null {
  if (obj instanceof PDFName) return DEVICE_SPACE[obj.decodeText()] ?? null
  if (obj instanceof PDFArray) {
    const head = obj.lookup(0)
    if (head instanceof PDFName) {
      const h = head.decodeText()
      if (h === 'CalGray') return 'gray'
      if (h === 'CalRGB') return 'rgb'
      if (h === 'ICCBased') {
        const st = obj.lookup(1)
        const n = st instanceof PDFRawStream ? st.dict.lookupMaybe(PDFName.of('N'), PDFNumber)?.asNumber() : undefined
        return n === 1 ? 'gray' : n === 3 ? 'rgb' : n === 4 ? 'cmyk' : null
      }
      return DEVICE_SPACE[h] ?? null
    }
  }
  return null
}

/** Converts interleaved 8-bit samples between device spaces. `count` is the number of pixels. */
export function convertSamples(raw: Uint8Array, from: Space, to: ColourMode, count: number): Uint8Array {
  const nIn = from === 'gray' ? 1 : from === 'rgb' ? 3 : 4
  const nOut = to === 'gray' ? 1 : to === 'rgb' ? 3 : 4
  const out = new Uint8Array(count * nOut)
  for (let i = 0, a = 0, b = 0; i < count; i++, a += nIn, b += nOut) {
    if (to === 'gray') {
      if (from === 'rgb') out[b] = (77 * raw[a] + 151 * raw[a + 1] + 28 * raw[a + 2]) >> 8
      else out[b] = Math.round(255 * toGray('cmyk', [raw[a] / 255, raw[a + 1] / 255, raw[a + 2] / 255, raw[a + 3] / 255]))
    } else if (to === 'rgb') {
      if (from === 'gray') out[b] = out[b + 1] = out[b + 2] = raw[a]
      else {
        const k = 255 - raw[a + 3]
        out[b] = ((255 - raw[a]) * k) / 255
        out[b + 1] = ((255 - raw[a + 1]) * k) / 255
        out[b + 2] = ((255 - raw[a + 2]) * k) / 255
      }
    } else if (from === 'gray') {
      out[b + 3] = 255 - raw[a]
    } else {
      const r = raw[a]
      const g = raw[a + 1]
      const bl = raw[a + 2]
      const k = 255 - Math.max(r, g, bl)
      if (k >= 255) out[b + 3] = 255
      else {
        out[b] = ((255 - r - k) * 255) / (255 - k)
        out[b + 1] = ((255 - g - k) * 255) / (255 - k)
        out[b + 2] = ((255 - bl - k) * 255) / (255 - k)
        out[b + 3] = k
      }
    }
  }
  return out
}

export interface ColourReport {
  mode: ColourMode
  operators: number
  pictures: number
  /** Pictures that could not be converted (other encodings, masks, indexed or spot colour, decode arrays). */
  picturesLeft: number
  spot: number
  shadings: number
  inlinePictures: number
}

/** Samples of an image in its own space, or null when this tool cannot read them. */
export async function samplesOf(stream: PDFRawStream, space: Space, w: number, h: number): Promise<Uint8Array | null> {
  const d = stream.dict
  const filter = filterOf(d)
  const n = space === 'gray' ? 1 : space === 'rgb' ? 3 : 4
  if (filter === 'DCTDecode') {
    if (space === 'cmyk' || typeof OffscreenCanvas === 'undefined') return null
    const bmp = await decode(stream, w, h)
    if (!bmp) return null
    const canvas = new OffscreenCanvas(w, h)
    const g = canvas.getContext('2d', { willReadFrequently: true })!
    g.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const px = g.getImageData(0, 0, w, h).data
    const raw = new Uint8Array(w * h * n)
    for (let i = 0; i < w * h; i++) {
      if (n === 1) raw[i] = px[i * 4]
      else {
        raw[i * 3] = px[i * 4]
        raw[i * 3 + 1] = px[i * 4 + 1]
        raw[i * 3 + 2] = px[i * 4 + 2]
      }
    }
    return raw
  }
  if (filter !== 'FlateDecode' && filter !== '') return null
  const parms = d.lookupMaybe(PDFName.of('DecodeParms'), PDFDict)
  const predictor = filter === 'FlateDecode' ? (parms?.lookupMaybe(PDFName.of('Predictor'), PDFNumber)?.asNumber() ?? 1) : 1
  if (predictor > 1 && predictor < 10) return null
  let raw = filter === 'FlateDecode' ? await inflate(stream.contents) : stream.contents
  if (predictor >= 10) {
    const un = unpredictPng(raw, w, n)
    if (!un) return null
    raw = un
  }
  return raw.length >= w * h * n ? raw : null
}

/** Converts the colours of the whole document to `mode`. */
export async function convertColours(bytes: Uint8Array, mode: ColourMode): Promise<{ bytes: Uint8Array; report: ColourReport }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const report: ColourReport = { mode, operators: 0, pictures: 0, picturesLeft: 0, spot: 0, shadings: 0, inlinePictures: 0 }
  for (const scope of contentScopes(doc)) {
    const src = scope.get()
    if (!src) continue
    const cs = scope.resources?.lookupMaybe(PDFName.of('ColorSpace'), PDFDict)
    const r = convertContent(src, mode, (name) => spaceFromObject(cs?.lookup(PDFName.of(name))))
    report.spot += r.spot
    report.shadings += r.shadings
    report.inlinePictures += r.inlineImages
    if (r.changed) {
      scope.set(r.src)
      report.operators += r.changed
    }
  }
  for (const { ref, stream } of imageStreams(doc)) {
    const d = stream.dict
    const space = spaceFromObject(d.lookup(PDFName.of('ColorSpace')))
    const w = d.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0
    const h = d.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0
    const bpc = d.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber()
    if (d.lookup(PDFName.of('ImageMask')) || !space || space === mode) {
      if (!space && !d.lookup(PDFName.of('ImageMask'))) report.picturesLeft++
      continue
    }
    if (!w || !h || bpc !== 8 || d.has(PDFName.of('Decode')) || d.has(PDFName.of('Mask'))) {
      report.picturesLeft++
      continue
    }
    const raw = await samplesOf(stream, space, w, h).catch(() => null)
    if (!raw) {
      report.picturesLeft++
      continue
    }
    const out = convertSamples(raw, space, mode, w * h)
    replaceStreamData(doc, ref, stream, out)
    const fresh = doc.context.lookup(ref) as PDFRawStream
    fresh.dict.set(PDFName.of('ColorSpace'), PDFName.of(DEVICE[mode]))
    fresh.dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
    report.pictures++
  }
  return { bytes: report.operators || report.pictures ? await doc.save() : bytes, report }
}

/** Plain sentences for the result, including what was left alone. */
export function describeColourReport(r: ColourReport): string[] {
  const name = r.mode === 'gray' ? 'greyscale' : r.mode === 'cmyk' ? 'CMYK' : 'RGB'
  const lines = [`Converted ${r.operators} colour setting${r.operators === 1 ? '' : 's'} and ${r.pictures} picture${r.pictures === 1 ? '' : 's'} to ${name} (approximate device conversion, no colour profile).`]
  if (r.picturesLeft) lines.push(`${r.picturesLeft} picture${r.picturesLeft === 1 ? ' was' : 's were'} left as they are (masks, indexed or spot colour, CMYK JPEG or another encoding).`)
  if (r.spot) lines.push(`${r.spot} spot, pattern or other special colour setting${r.spot === 1 ? ' was' : 's were'} left as they are.`)
  if (r.shadings) lines.push(`${r.shadings} shading${r.shadings === 1 ? ' was' : 's were'} left as they are.`)
  if (r.inlinePictures) lines.push(`${r.inlinePictures} inline picture${r.inlinePictures === 1 ? ' was' : 's were'} left as they are.`)
  return lines
}
