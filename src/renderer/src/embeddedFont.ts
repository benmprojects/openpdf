/**
 * Fonts that a page already uses: listing them, and writing new text with one of them. The text is encoded with the
 * font's own character codes, read from its ToUnicode map (or, for a simple font that is not a subset, WinAnsi).
 * A subset font only has the glyphs the file already uses, so characters outside that set are reported as missing
 * instead of being drawn as blanks.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream, type PDFObject, type PDFPage } from 'pdf-lib'
import { bytesToString } from './content'

export interface PageFontInfo {
  /** The name the page's resources give the font (without the slash). */
  resource: string
  baseFont: string
  /** A subset font (name starts with six capitals and a plus sign): only the glyphs already used are in the file. */
  subset: boolean
  /** The font program is stored in the file. */
  embedded: boolean
  /** A composite (Type 0) font with two-byte codes. */
  composite: boolean
}

function fontResources(page: PDFPage): PDFDict | undefined {
  let node: PDFDict | undefined = page.node
  for (let i = 0; node && i < 32; i++) {
    const res = node.lookupMaybe(PDFName.of('Resources'), PDFDict)
    if (res) return res.lookupMaybe(PDFName.of('Font'), PDFDict)
    node = node.lookupMaybe(PDFName.of('Parent'), PDFDict)
  }
  return undefined
}

const nameOf = (o: PDFObject | undefined): string => (o instanceof PDFName ? o.decodeText() : '')
const numberOf = (o: PDFObject | undefined): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined)

function hasProgram(desc: PDFDict | undefined): boolean {
  if (!desc) return false
  return ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.lookup(PDFName.of(k)) instanceof PDFStream)
}

function describe(resource: string, font: PDFDict): PageFontInfo | null {
  const subtype = nameOf(font.lookup(PDFName.of('Subtype')))
  if (subtype === 'Type3' || !subtype) return null
  const baseFont = nameOf(font.lookup(PDFName.of('BaseFont')))
  const composite = subtype === 'Type0'
  let desc: PDFDict | undefined
  if (composite) {
    const kids = font.lookup(PDFName.of('DescendantFonts'))
    const first = kids instanceof PDFArray ? kids.lookup(0) : undefined
    desc = first instanceof PDFDict ? first.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict) : undefined
  } else desc = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
  return { resource, baseFont: baseFont.replace(/^[A-Z]{6}\+/, ''), subset: /^[A-Z]{6}\+/.test(baseFont), embedded: hasProgram(desc), composite }
}

/** The fonts in the page's resources (Type 3 fonts left out), in resource order. */
export function listPageFonts(page: PDFPage): PageFontInfo[] {
  const fonts = fontResources(page)
  if (!fonts) return []
  const out: PageFontInfo[] = []
  for (const [key] of fonts.entries()) {
    const f = fonts.lookup(key)
    if (!(f instanceof PDFDict)) continue
    const info = describe(key.decodeText(), f)
    if (info) out.push(info)
  }
  return out
}

/** Reads the code to text map of a ToUnicode CMap (bfchar and bfrange). */
export function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>()
  const uni = (hex: string): string => {
    let s = ''
    for (let i = 0; i + 3 < hex.length + 1; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
    return s
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), uni(m[2]))
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]+>)/g)) {
      const lo = parseInt(m[1], 16)
      const hi = parseInt(m[2], 16)
      if (hi < lo || hi - lo > 65535) continue
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => uni(x[1]))
        items.forEach((s, i) => lo + i <= hi && map.set(lo + i, s))
      } else {
        const base = uni(m[3].slice(1, -1))
        for (let c = lo; c <= hi; c++) {
          const last = base.charCodeAt(base.length - 1) + (c - lo)
          map.set(c, base.slice(0, -1) + String.fromCharCode(last))
        }
      }
    }
  }
  return map
}

/** WinAnsi codes 0x80 to 0x9F, which differ from Latin-1. */
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ'
}

/** Code to text for WinAnsi (printable codes only). */
export function winAnsiMap(): Map<number, string> {
  const m = new Map<number, string>()
  for (let c = 0x20; c <= 0x7e; c++) m.set(c, String.fromCharCode(c))
  for (let c = 0xa0; c <= 0xff; c++) m.set(c, String.fromCharCode(c))
  for (const [c, s] of Object.entries(WIN_ANSI_HIGH)) m.set(Number(c), s)
  return m
}

export interface EncodeResult {
  /** The codes as bytes (one character per byte), ready for a hex string. */
  bytes: string
  /** Characters the font cannot show. */
  missing: string[]
}

export interface FontCodec {
  info: PageFontInfo
  /** Width of the text in points at `size`. */
  widthOf(text: string, size: number): number
  /** Codes for `text`. `known` lists characters that are certainly in the font (those of the text being replaced). */
  encode(text: string, known?: string): EncodeResult
}

/** Why a font cannot be used to write new text, or null when it can. */
export type FontProblem = string

/** Builds the code table and widths. `toUnicode` and `widths` are as read from the font dictionary. */
export function buildCodec(
  info: PageFontInfo,
  src: { toUnicode?: string; winAnsi: boolean; widths: (code: number) => number; bytesPerCode: 1 | 2; originalCodes?: Map<string, number> }
): FontCodec {
  const reverse = new Map<string, number>()
  const add = (m: Map<number, string>) => {
    for (const [code, s] of m) if ([...s].length === 1 && !reverse.has(s)) reverse.set(s, code)
  }
  if (src.toUnicode) add(parseToUnicode(src.toUnicode))
  // A whole simple font (not a subset) has every WinAnsi glyph; a subset only has what its ToUnicode map lists.
  if (src.winAnsi && !info.subset) add(winAnsiMap())
  const win = new Map<string, number>()
  if (src.winAnsi) for (const [code, ch] of winAnsiMap()) win.set(ch, code)
  const codeWidth = src.bytesPerCode
  const widthOfText = (text: string, size: number) => {
    let w = 0
    for (const ch of text) {
      const code = reverse.get(ch)
      w += (code === undefined ? 500 : src.widths(code)) / 1000
    }
    return w * size
  }
  return {
    info,
    widthOf: widthOfText,
    encode(text, known = '') {
      let bytes = ''
      const missing: string[] = []
      for (const ch of text.replace(/\n/g, ' ')) {
        let code = reverse.get(ch)
        // A subset keeps the codes of the characters it has: those of the text being replaced are certainly there.
        if (code === undefined && known.includes(ch)) code = win.get(ch)
        if (code === undefined) {
          if (!missing.includes(ch)) missing.push(ch)
          continue
        }
        bytes += codeWidth === 2 ? String.fromCharCode((code >> 8) & 255, code & 255) : String.fromCharCode(code & 255)
      }
      return { bytes, missing }
    }
  }
}

function streamText(o: PDFObject | undefined): string | undefined {
  if (o instanceof PDFRawStream) return bytesToString(decodePDFRawStream(o).decode())
  if (o instanceof PDFStream) return bytesToString((o as unknown as { getContents(): Uint8Array }).getContents())
  return undefined
}

/** Widths of a composite font's descendant (`/W` and `/DW`), per code, in thousandths of an em. */
export function compositeWidths(w: PDFArray | undefined, dw: number): (code: number) => number {
  const table = new Map<number, number>()
  if (w) {
    let i = 0
    while (i < w.size()) {
      const first = numberOf(w.lookup(i))
      const next = w.lookup(i + 1)
      if (first === undefined) break
      if (next instanceof PDFArray) {
        for (let k = 0; k < next.size(); k++) table.set(first + k, numberOf(next.lookup(k)) ?? dw)
        i += 2
      } else {
        const last = numberOf(next)
        const width = numberOf(w.lookup(i + 2))
        if (last === undefined || width === undefined) break
        for (let c = first; c <= last && c - first < 65536; c++) table.set(c, width)
        i += 3
      }
    }
  }
  return (code) => table.get(code) ?? dw
}

/**
 * Opens a font of the page for writing text. Returns the codec, or a message saying why this font cannot be written
 * with (a composite font with a named CMap, a simple font with an unknown encoding and no ToUnicode map).
 */
export function openPageFont(page: PDFPage, resource: string): { codec: FontCodec } | { problem: FontProblem } {
  const fonts = fontResources(page)
  const font = fonts?.lookup(PDFName.of(resource))
  if (!(font instanceof PDFDict)) return { problem: 'That font is no longer on the page.' }
  const info = describe(resource, font)
  if (!info) return { problem: 'That kind of font cannot be used for new text.' }
  const toUnicode = streamText(font.lookup(PDFName.of('ToUnicode')))
  if (info.composite) {
    const enc = font.lookup(PDFName.of('Encoding'))
    if (nameOf(enc) !== 'Identity-H') return { problem: `The font "${info.baseFont}" uses a character map that cannot be written with. Choose a standard font instead.` }
    if (!toUnicode) return { problem: `The font "${info.baseFont}" does not say which characters its codes stand for, so new text cannot be written with it. Choose a standard font instead.` }
    const kids = font.lookup(PDFName.of('DescendantFonts'))
    const desc = kids instanceof PDFArray ? kids.lookup(0) : undefined
    const dw = desc instanceof PDFDict ? (numberOf(desc.lookup(PDFName.of('DW'))) ?? 1000) : 1000
    const w = desc instanceof PDFDict ? desc.lookup(PDFName.of('W')) : undefined
    return { codec: buildCodec(info, { toUnicode, winAnsi: false, widths: compositeWidths(w instanceof PDFArray ? w : undefined, dw), bytesPerCode: 2 }) }
  }
  const enc = font.lookup(PDFName.of('Encoding'))
  const encName = nameOf(enc)
  const encDict = enc instanceof PDFDict ? enc : undefined
  const baseName = encDict ? nameOf(encDict.lookup(PDFName.of('BaseEncoding'))) : encName
  const differences = encDict?.lookup(PDFName.of('Differences')) instanceof PDFArray
  const winAnsi = !differences && (baseName === 'WinAnsiEncoding' || (baseName === '' && !toUnicode && !info.subset && !info.embedded))
  if (!toUnicode && !winAnsi && !info.subset) return { problem: `The font "${info.baseFont}" has an encoding that cannot be written with. Choose a standard font instead.` }
  const first = numberOf(font.lookup(PDFName.of('FirstChar'))) ?? 0
  const list = font.lookup(PDFName.of('Widths'))
  const desc = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
  const missingWidth = desc ? (numberOf(desc.lookup(PDFName.of('MissingWidth'))) ?? 0) : 0
  const widths = (code: number): number => {
    if (list instanceof PDFArray && code >= first && code - first < list.size()) return numberOf(list.lookup(code - first)) ?? missingWidth
    return missingWidth || 500
  }
  return { codec: buildCodec(info, { toUnicode, winAnsi, widths, bytesPerCode: 1 }) }
}

/** The message for characters a page font cannot show. */
export function missingGlyphMessage(info: PageFontInfo, missing: string[]): string {
  const list = missing.slice(0, 8).map((c) => `"${c}"`).join(', ')
  return info.subset
    ? `The font "${info.baseFont}" in this file is a subset: it only holds the characters the file already uses, so ${list} cannot be typed with it. Choose a standard font instead.`
    : `The font "${info.baseFont}" in this file has no usable code for ${list}. Choose a standard font instead.`
}
