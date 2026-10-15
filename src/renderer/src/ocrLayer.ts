/**
 * Puts recognised text back into a PDF as an invisible layer (text rendering mode 3) over the page picture, so the
 * page can be searched, selected and copied while it looks exactly as before. Words are placed from the recognition
 * boxes: sized from the box height, squeezed or stretched to the box width, on the line's baseline.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFFont, StandardFonts, TextRenderingMode, beginText, endText, popGraphicsState, pushGraphicsState, setFontAndSize, setCharacterSqueeze, setTextMatrix, setTextRenderingMode, showText } from 'pdf-lib'
import { frameFor } from './annotWrite'
import { embeddable } from './textEdit'
import type { OcrLine } from '../../main/ocr'

export interface OcrInput {
  /** Zero-based page. */
  page: number
  /** Pixels per point of the displayed page that the image was rendered at. */
  scale: number
  lines: OcrLine[]
}

export interface OcrWritten {
  bytes: Uint8Array
  words: number
  /** Words left out because the font could not show any of their characters. */
  skipped: number
}

/** The y of a line's baseline (pixels) at a given x. */
export function baselineAt(line: OcrLine, x: number, fallback: number): number {
  const b = line.baseline
  if (!(b.x1 > b.x0) || !Number.isFinite(b.y0) || !Number.isFinite(b.y1) || (b.y0 === 0 && b.y1 === 0)) return fallback
  return b.y0 + ((b.y1 - b.y0) * (x - b.x0)) / (b.x1 - b.x0)
}

/** Installed font families that cover the scripts of these Tesseract languages, best first; none for Latin scripts. */
export function fontsForLanguages(langs: string[]): string[] {
  const map: Record<string, string[]> = {
    ara: ['Arial'],
    heb: ['Arial'],
    rus: ['Arial'],
    ukr: ['Arial'],
    bul: ['Arial'],
    ell: ['Arial'],
    hin: ['Nirmala UI'],
    tha: ['Leelawadee UI', 'Tahoma'],
    chi_sim: ['Microsoft YaHei', 'SimSun'],
    chi_tra: ['Microsoft JhengHei', 'MingLiU'],
    jpn: ['Yu Gothic', 'MS Gothic'],
    kor: ['Malgun Gothic']
  }
  return [...new Set(langs.flatMap((l) => map[l] ?? []))]
}

/** Adds the invisible text layer to the pages in `inputs`. `unicode` is an installed font file for non-Latin text. */
export async function addTextLayer(bytes: Uint8Array, inputs: OcrInput[], unicode?: Uint8Array | null): Promise<OcrWritten> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const allText = inputs.flatMap((i) => i.lines.flatMap((l) => l.words.map((w) => w.text))).join('')
  let font: PDFFont
  if (unicode && embeddable(unicode, allText)) {
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(unicode, { subset: true })
  } else font = await doc.embedFont(StandardFonts.Helvetica)
  const encode = (s: string): string => {
    // Keep what the font can show; a word it cannot show at all is skipped.
    return [...s].filter((ch) => {
      try {
        font.encodeText(ch)
        return true
      } catch {
        return false
      }
    }).join('')
  }
  let words = 0
  let skipped = 0
  for (const input of inputs) {
    const page = doc.getPage(input.page)
    const cb = page.getCropBox()
    const f = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, page.getRotation().angle).m
    const fontKey = page.node.newFontDictionary(font.name, font.ref)
    const ops = []
    for (const line of input.lines) {
      for (const w of line.words) {
        const text = encode(w.text)
        if (!text) {
          skipped++
          continue
        }
        const hPt = (w.y1 - w.y0) / input.scale
        const wPt = (w.x1 - w.x0) / input.scale
        if (!(hPt > 0.5) || !(wPt > 0.5)) continue
        const size = Math.max(2, Math.min(200, hPt * 0.85))
        const natural = font.widthOfTextAtSize(text, size) || wPt
        const tz = Math.max(10, Math.min(500, (wPt / natural) * 100))
        const baseY = baselineAt(line, (w.x0 + w.x1) / 2, w.y1 - (w.y1 - w.y0) * 0.2) / input.scale
        // Display point (y down) to page space; the text runs along display x and up is display -y.
        const dx = w.x0 / input.scale
        const px = f[0] * dx + f[2] * baseY + f[4]
        const py = f[1] * dx + f[3] * baseY + f[5]
        ops.push(
          pushGraphicsState(),
          beginText(),
          setFontAndSize(fontKey, size),
          setTextRenderingMode(TextRenderingMode.Invisible),
          setCharacterSqueeze(tz),
          setTextMatrix(f[0], f[1], -f[2], -f[3], px, py),
          showText(font.encodeText(text)),
          endText(),
          popGraphicsState()
        )
        words++
      }
    }
    if (ops.length) page.pushOperators(...ops)
  }
  return { bytes: await doc.save(), words, skipped }
}
