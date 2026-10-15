/**
 * Edit existing text. PDFium tells us which text object is under the pointer (the k-th text object of the page is the
 * k-th non-empty text-showing operator of its content stream). Here the operator is taken out of the stream and the
 * new text is drawn with pdf-lib in the same place, size and colour, in a standard font chosen to match.
 */
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream, StandardFonts, decodePDFRawStream, degrees, rgb, type PDFPage } from 'pdf-lib'
import { bytesToString, isShow, num, parseContent, removeOps, showBytes, showOrigins, stringToBytes, type Op } from './content'

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

/** The standard font closest to a font's name and descriptor. */
export function pickStandardFont(s: Pick<TextStyle, 'font' | 'flags' | 'weight' | 'italic'>): StandardFonts {
  const bold = BOLD.test(s.font) || s.weight >= 600 || (s.flags & 0x40000) !== 0
  const italic = s.italic || ITALIC.test(s.font)
  const mono = MONO.test(s.font) || (s.flags & 1) !== 0
  const serif = !/sans/i.test(s.font) && (SERIF.test(s.font) || (!/arial|helvet|calibri|verdana|tahoma|segoe|roboto|open ?sans/i.test(s.font) && (s.flags & 2) !== 0))
  if (mono) return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : italic ? StandardFonts.CourierOblique : StandardFonts.Courier
  if (serif) return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica
}

/** Decoded content of a page as one string, and the stream objects it came from. */
function pageContent(page: PDFPage): string {
  const c = page.node.lookup(PDFName.of('Contents'))
  const parts: unknown[] = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i)) : [c]
  let src = ''
  for (const st of parts) {
    if (st instanceof PDFRawStream) src += bytesToString(decodePDFRawStream(st).decode()) + '\n'
    else if (st instanceof PDFStream) src += bytesToString((st as unknown as { getContents(): Uint8Array }).getContents()) + '\n'
  }
  return src
}

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

/** Replaces the text of one text object. An empty `text` deletes it. Returns the new file. */
export async function replaceText(bytes: Uint8Array, target: TextEditTarget, text: string, style: TextStyle): Promise<{ bytes: Uint8Array; hiddenOriginal: boolean }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const page = doc.getPage(target.page)
  const src = pageContent(page)
  const ops = parseContent(src)
  const shows = ops.map((o, i) => (isShow(o) && showBytes(o).length > 0 ? i : -1)).filter((i) => i >= 0)
  if (shows.length !== target.total) throw new Error('The text on this page cannot be edited safely (its content did not match).')
  const idx = shows[target.ordinal]
  if (idx === undefined) throw new Error('That text could not be found in the page content.')
  const op = ops[idx]
  // The operator and PDFium's object must be the same text: compare where they start, when the stream says where.
  const allShows = ops.map((o, i) => (isShow(o) ? i : -1)).filter((i) => i >= 0)
  const origin = showOrigins(ops)[allShows.indexOf(idx)]
  if (origin && Math.hypot(origin.x - style.matrix[4], origin.y - style.matrix[5]) > 1) throw new Error('The page changed under the edit; select the text again.')

  // Take the original out, keeping what follows in place.
  let out: string
  let hiddenOriginal = false
  const safe = removalKeepsLayout(ops, idx)
  if (safe) {
    if (op.op === "'" || op.op === '"') {
      // ' and " also move to the next line (and " sets word and character spacing): keep that part.
      const spacing = op.op === '"' && op.operands.length >= 3 && op.operands[0].t === 'num' && op.operands[1].t === 'num' ? `${num(op.operands[0].v)} Tw ${num(op.operands[1].v)} Tc ` : ''
      out = src.slice(0, op.start) + spacing + 'T*' + src.slice(op.end)
    } else out = removeOps(src, ops, new Set([idx]))
  } else {
    // Later text on the line depends on this one's advance: keep the operation but make it invisible.
    const prev = renderModeBefore(ops, idx)
    out = `${src.slice(0, op.start)}3 Tr ${src.slice(op.start, op.end)} ${prev} Tr${src.slice(op.end)}`
    hiddenOriginal = true
  }
  const ctx = doc.context
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(stringToBytes(out))))

  if (text) {
    const font = await doc.embedFont(pickStandardFont(style))
    const [a, b] = style.matrix
    const scale = Math.hypot(a, b) || 1
    try {
      font.encodeText(text)
    } catch {
      throw new Error('The replacement font cannot show some of those characters.')
    }
    page.drawText(text, { x: style.matrix[4], y: style.matrix[5], font, size: style.size * (scale === 1 ? 1 : scale), color: hexRgb(style.color), rotate: degrees((Math.atan2(b, a) * 180) / Math.PI) })
  }
  return { bytes: await doc.save(), hiddenOriginal }
}
