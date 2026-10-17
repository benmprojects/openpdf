/**
 * Edit existing text. PDFium tells us which text object is under the pointer (the k-th text object of the page is the
 * k-th non-empty text-showing operator of its content stream). Here the operator is taken out of the stream and the
 * new text is drawn with pdf-lib in the same place, size and colour, in a standard font chosen to match.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from 'pdf-lib'
import { pageContent } from './pageContent'
import { isShow, num, parseContent, showBytes, showOrigins, stringToBytes, hexString, type Op } from './content'
import { missingGlyphMessage, openPageFont } from './embeddedFont'
import { hexToUnit } from './objectOps'

export interface TextEditTarget {
  /** Zero-based page. */
  page: number
  /** Which text object of the page (as PDFium counts them). */
  ordinal: number
  /** How many text objects PDFium found on the page; must equal the content stream's count. */
  total: number
}

export interface TextStyle {
  font: string
  flags: number
  weight: number
  italic: boolean
  /** Effective size in points. */
  size: number
  color: string
  /** The object's matrix in page space. */
  matrix: [number, number, number, number, number, number]
}

const BOLD = /bold|black|heavy|semibold|demi|extrabold/i
const ITALIC = /italic|oblique|slanted/i
const MONO = /courier|consolas|mono|lucida console|menlo|typewriter/i
const SERIF = /times|georgia|garamond|palatino|cambria|serif|roman|book|minion|century/i

/** Whether the font is bold and italic, from its name, weight and descriptor flags. */
export function weightAndSlant(s: Pick<TextStyle, 'font' | 'flags' | 'weight' | 'italic'>): { bold: boolean; italic: boolean } {
  return { bold: BOLD.test(s.font) || s.weight >= 600 || (s.flags & 0x40000) !== 0, italic: s.italic || ITALIC.test(s.font) }
}

export type StandardFamily = 'helvetica' | 'times' | 'courier' | 'symbol' | 'zapf'

/** The standard font family closest to a font's name and descriptor. */
export function familyOf(s: Pick<TextStyle, 'font' | 'flags'>): StandardFamily {
  const mono = MONO.test(s.font) || (s.flags & 1) !== 0
  const serif = !/sans/i.test(s.font) && (SERIF.test(s.font) || (!/arial|helvet|calibri|verdana|tahoma|segoe|roboto|open ?sans/i.test(s.font) && (s.flags & 2) !== 0))
  return mono ? 'courier' : serif ? 'times' : 'helvetica'
}

/** One of the standard 14 fonts: a family, with bold and italic where the family has them (Symbol and Zapf Dingbats have neither). */
export function standardFor(family: StandardFamily, bold: boolean, italic: boolean): StandardFonts {
  if (family === 'symbol') return StandardFonts.Symbol
  if (family === 'zapf') return StandardFonts.ZapfDingbats
  if (family === 'courier') return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : italic ? StandardFonts.CourierOblique : StandardFonts.Courier
  if (family === 'times') return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica
}

/** The standard font closest to a font's name and descriptor. */
export function pickStandardFont(s: Pick<TextStyle, 'font' | 'flags' | 'weight' | 'italic'>): StandardFonts {
  const { bold, italic } = weightAndSlant(s)
  return standardFor(familyOf(s), bold, italic)
}

/** Changes to the look of text that is being rewritten. Whatever is left out stays as the original had it. */
export interface TextFormat {
  /** A standard family. Overrides the matched font. */
  family?: StandardFamily
  /** The resource name of a font the page already uses; takes precedence over `family`. */
  pageFont?: string
  bold?: boolean
  italic?: boolean
  /** Size in points on the page. */
  size?: number
  /** #rrggbb */
  color?: string
}

/** Whether the format asks for anything. */
export const formatIsEmpty = (f: TextFormat | null | undefined): boolean => !f || (f.family === undefined && f.pageFont === undefined && f.bold === undefined && f.italic === undefined && f.size === undefined && f.color === undefined)

/** Text Render Mode in force just before operation `idx`, following q/Q. */
function renderModeBefore(ops: Op[], idx: number): number {
  let mode = 0
  const stack: number[] = []
  for (let i = 0; i < idx; i++) {
    const o = ops[i]
    if (o.op === 'q') stack.push(mode)
    else if (o.op === 'Q') mode = stack.pop() ?? mode
    else if (o.op === 'Tr' && o.operands[0]?.t === 'num') mode = o.operands[0].v
  }
  return mode
}

/**
 * Whether removing show operation `idx` leaves later text where it was: true when the next text-showing operation in
 * the same text object starts from a fresh position (Td, TD, T*, Tm, ' or ") or there is none. Plain Tj/TJ run on
 * from the end of the previous one, so taking one out would pull the rest along.
 */
export function removalKeepsLayout(ops: Op[], idx: number): boolean {
  for (let i = idx + 1; i < ops.length; i++) {
    const op = ops[i].op
    if (op === 'ET' || op === 'BT') return true
    if (op === 'Td' || op === 'TD' || op === 'T*' || op === 'Tm') return true
    if (op === "'" || op === '"') return true
    if (op === 'Tj' || op === 'TJ') return showBytes(ops[i]).length === 0
  }
  return true
}

function hexRgb(hex: string): ReturnType<typeof rgb> {
  const n = parseInt(hex.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export interface BlockTarget {
  /** Zero-based page. */
  page: number
  /** The text objects being replaced (as PDFium counts them), in content order. */
  ordinals: number[]
  /** How many text objects PDFium found on the page; must equal the content stream's count. */
  total: number
  /** Where PDFium puts the start of each of those objects in page space, to check the stream against. */
  origins: { x: number; y: number }[]
}

/** Where a paragraph sits, so a reflowed one lines up with the original. All in page space. */
export interface BlockLayout {
  firstX: number
  restX: number
  baselineY: number
  /** Distance between baselines; 0 for a single line, which is then not wrapped. */
  leading: number
  /** Width of the widest line. */
  width: number
}

/**
 * Greedy word wrap. Blank-line breaks in `text` (newlines) are kept. A word wider than the line is left on a line of
 * its own. `widthOf` measures a string in points; the first line may have a different width (an indent).
 */
export function wrapText(text: string, widthOf: (s: string) => number, firstWidth: number, restWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = ''
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (!line || widthOf(candidate) <= (out.length === 0 ? firstWidth : restWidth)) line = candidate
      else {
        out.push(line)
        line = w
      }
    }
    out.push(line)
  }
  return out
}

/**
 * Whether removing show operation `idx` leaves later text where it was, given that every operation in `removing` is
 * being removed too (and `removable` says which of those, later in the stream, really can be).
 */
function nextKeepsLayout(ops: Op[], idx: number, removing: ReadonlySet<number>, removable: ReadonlyMap<number, boolean>): boolean {
  for (let i = idx + 1; i < ops.length; i++) {
    const op = ops[i].op
    if (op === 'ET' || op === 'BT' || op === 'Td' || op === 'TD' || op === 'T*' || op === 'Tm' || op === "'" || op === '"') return true
    if ((op === 'Tj' || op === 'TJ') && showBytes(ops[i]).length > 0) return removing.has(i) && removable.get(i) === true
  }
  return true
}

/**
 * Replaces the text of one or more text objects with `text`. One object: drawn where it was (a longer text runs on).
 * Several objects forming a paragraph (with a `layout` that has a line spacing): the text is wrapped to the
 * paragraph's width and drawn line by line. An empty `text` deletes the objects. Returns the new file.
 */
export async function replaceBlock(
  bytes: Uint8Array,
  target: BlockTarget,
  text: string,
  style: TextStyle,
  /** An installed font with the original's family: used when it may be embedded and has every character. */
  installed?: Uint8Array | null,
  layout?: BlockLayout | null,
  /** New font, size, colour, bold or italic for the rewritten text. */
  format?: TextFormat | null,
  /** The text being replaced, so a subset font can still write the characters it already holds. */
  originalText = ''
): Promise<{ bytes: Uint8Array; hiddenOriginal: boolean; fontUsed: string }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const page = doc.getPage(target.page)
  const src = pageContent(page)
  const ops = parseContent(src)
  const shows = ops.map((o, i) => (isShow(o) && showBytes(o).length > 0 ? i : -1)).filter((i) => i >= 0)
  if (shows.length !== target.total) throw new Error('The text on this page cannot be edited safely (its content did not match).')
  const idxs = target.ordinals.map((o) => shows[o])
  if (!idxs.length || idxs.some((i) => i === undefined)) throw new Error('That text could not be found in the page content.')
  // Each operator and PDFium's object must be the same text: compare where they start, when the stream says where.
  const allShows = ops.map((o, i) => (isShow(o) ? i : -1)).filter((i) => i >= 0)
  const origins = showOrigins(ops)
  idxs.forEach((idx, k) => {
    const origin = origins[allShows.indexOf(idx)]
    const want = target.origins[k]
    if (origin && want && Math.hypot(origin.x - want.x, origin.y - want.y) > 1) throw new Error('The page changed under the edit; select the text again.')
  })

  // Take the originals out, keeping what follows in place; where that is not possible, make them invisible instead.
  const removing = new Set(idxs)
  const removable = new Map<number, boolean>()
  for (const idx of [...idxs].sort((x, y) => y - x)) removable.set(idx, nextKeepsLayout(ops, idx, removing, removable))
  const edits: { start: number; end: number; text: string }[] = []
  let hiddenOriginal = false
  for (const idx of idxs) {
    const op = ops[idx]
    if (removable.get(idx)) {
      if (op.op === "'" || op.op === '"') {
        // ' and " also move to the next line (and " sets word and character spacing): keep that part.
        const spacing = op.op === '"' && op.operands.length >= 3 && op.operands[0].t === 'num' && op.operands[1].t === 'num' ? `${num(op.operands[0].v)} Tw ${num(op.operands[1].v)} Tc ` : ''
        edits.push({ start: op.start, end: op.end, text: spacing + 'T*' })
      } else {
        // Also drop the whitespace before it, so no double space is left behind.
        let cut = op.start
        while (cut > 0 && /\s/.test(src[cut - 1])) cut--
        edits.push({ start: cut, end: op.end, text: '' })
      }
    } else {
      // Later text on the line depends on this one's advance: keep the operation but make it invisible.
      edits.push({ start: op.start, end: op.end, text: `3 Tr ${src.slice(op.start, op.end)} ${renderModeBefore(ops, idx)} Tr` })
      hiddenOriginal = true
    }
  }
  let out = src
  for (const e of edits.sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  const ctx = doc.context
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(stringToBytes(out))))

  let fontUsed = 'standard'
  if (text) {
    const [a, b] = style.matrix
    const scale = Math.hypot(a, b) || 1
    const originalSize = style.size * scale
    const size = format?.size !== undefined && format.size > 0 ? format.size : originalSize
    const color = format?.color && hexToUnit(format.color) ? format.color : style.color
    const angle = (Math.atan2(b, a) * 180) / Math.PI
    const upright = Math.abs(angle) < 0.01
    const wrap = !!layout && layout.leading > 0 && idxs.length > 1
    const pitch = (layout?.leading || originalSize * 1.2) * (size / (originalSize || 1))
    const place = (i: number) => ({
      x: layout && wrap ? (i === 0 ? layout.firstX : layout.restX) : style.matrix[4],
      y: (layout && wrap ? layout.baselineY : style.matrix[5]) - i * pitch
    })
    const layoutLines = (widthOf: (s: string) => number) =>
      upright ? (wrap ? wrapText(text, widthOf, layout!.width - (layout!.firstX - layout!.restX), layout!.width) : text.split('\n')) : [text.replace(/\n/g, ' ')]

    if (format?.pageFont) {
      // A font the file already holds: draw with its own character codes.
      const opened = openPageFont(page, format.pageFont)
      if ('problem' in opened) throw new Error(opened.problem)
      const codec = opened.codec
      const lines = layoutLines((s) => codec.widthOf(s, size))
      const rgbc = hexToUnit(color) ?? [0, 0, 0]
      const known = originalText.replace(/\n/g, ' ')
      const missing: string[] = []
      const parts: string[] = []
      const rad = (angle * Math.PI) / 180
      lines.forEach((line, i) => {
        if (!line) return
        const enc = codec.encode(line, known)
        enc.missing.forEach((m) => !missing.includes(m) && missing.push(m))
        const { x, y } = place(i)
        parts.push(`BT /${format.pageFont} ${num(size)} Tf ${[Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), x, y].map(num).join(' ')} Tm ${hexString(enc.bytes)} Tj ET`)
      })
      if (missing.length) throw new Error(missingGlyphMessage(codec.info, missing))
      const ctx2 = doc.context
      page.node.set(PDFName.of('Contents'), ctx2.register(ctx2.flateStream(stringToBytes(`${out}\nq ${rgbc.map(num).join(' ')} rg ${parts.join(' ')} Q\n`))))
      fontUsed = 'page'
    } else {
      let font: Awaited<ReturnType<PDFDocument['embedFont']>> | null = null
      const explicit = !!format && (format.family !== undefined || format.bold !== undefined || format.italic !== undefined)
      if (installed && !format?.family && embeddable(installed, text)) {
        doc.registerFontkit(fontkit)
        font = await doc.embedFont(installed, { subset: true })
        fontUsed = 'installed'
      }
      if (!font) {
        const base = weightAndSlant(style)
        const family = format?.family ?? familyOf(style)
        font = await doc.embedFont(explicit ? standardFor(family, format?.bold ?? base.bold, format?.italic ?? base.italic) : pickStandardFont(style))
      }
      try {
        font.encodeText(text.replace(/\n/g, ' '))
      } catch {
        throw new Error('The replacement font cannot show some of those characters.')
      }
      const used = font
      const lines = layoutLines((s) => used.widthOfTextAtSize(s, size))
      lines.forEach((line, i) => {
        if (!line) return
        const { x, y } = place(i)
        page.drawText(line, { x, y, font: used, size, color: hexRgb(color), rotate: degrees(angle) })
      })
    }
  }
  return { bytes: await doc.save(), hiddenOriginal, fontUsed }
}

/** Replaces the text of one text object. An empty `text` deletes it. Returns the new file. */
export function replaceText(
  bytes: Uint8Array,
  target: TextEditTarget,
  text: string,
  style: TextStyle,
  installed?: Uint8Array | null
): Promise<{ bytes: Uint8Array; hiddenOriginal: boolean; fontUsed: string }> {
  return replaceBlock(bytes, { page: target.page, ordinals: [target.ordinal], total: target.total, origins: [{ x: style.matrix[4], y: style.matrix[5] }] }, text, style, installed, null)
}

/** Whether a font file may be embedded (OS/2 fsType: not restricted) and has a glyph for every character of `text`. */
export function embeddable(data: Uint8Array, text: string): boolean {
  try {
    const f = fontkit.create(data as never) as unknown as { hasGlyphForCodePoint(cp: number): boolean; 'OS/2'?: { fsType?: number } }
    const fsType = f['OS/2']?.fsType ?? 0
    if (fsType & 0x0002) return false
    for (const ch of text) if (ch !== '\n' && !f.hasGlyphForCodePoint(ch.codePointAt(0)!)) return false
    return true
  } catch {
    return false
  }
}
