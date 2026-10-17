/**
 * Puts recognised text back into a PDF as an invisible layer (text rendering mode 3) over the page picture, so the
 * page can be searched, selected and copied while it looks exactly as before. Words are placed from the recognition
 * boxes: sized from the box height, squeezed or stretched to the box width, on the line's baseline.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFDict, PDFDocument, PDFFont, PDFName, StandardFonts, TextRenderingMode, beginText, endText, popGraphicsState, pushGraphicsState, setFillingGrayscaleColor, setFontAndSize, setCharacterSqueeze, setTextMatrix, setTextRenderingMode, showText } from 'pdf-lib'
import { frameFor } from './annotWrite'
import { embeddable } from './textEdit'
import { imageDraws, parseContent, removeOps } from './content'
import { isImageXObject, pageContent, setPageContent } from './pageContent'
import { pruneUnreachable } from './redact'
import { findTables, type TableHint } from './tableHints'
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
export async function addTextLayer(bytes: Uint8Array, inputs: OcrInput[], unicode?: Uint8Array | null, visible = false): Promise<OcrWritten> {
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
          setFillingGrayscaleColor(0),
          setTextRenderingMode(visible ? TextRenderingMode.Fill : TextRenderingMode.Invisible),
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

// ---- Whole documents -------------------------------------------------------------------------------

export interface OcrRun {
  languages: string[]
  dpi: number
  /** Pages that have no text yet, or all of them. */
  scope: 'blank' | 'all'
  /** Only these pages (zero-based), when given. */
  pages?: number[]
  /**
   * What to write: the recognised text as an invisible layer over the page picture (searchable), or as visible text
   * with the page picture taken out (replace: the page is then only as good as the recognition).
   */
  output?: 'searchable' | 'replace'
}

export interface OcrDeps {
  /** A loaded copy of the document being recognised. */
  client: { render(page: number, scale: number): Promise<{ width: number; height: number; data: Uint8Array }>; pageText(page: number): Promise<{ text: string }> }
  /** Page sizes in points, as displayed. */
  pages: { width: number; height: number }[]
  recognise: (png: Uint8Array, languages: string[]) => Promise<{ lines: OcrLine[]; confidence: number }>
  findFont: (family: string) => Promise<Uint8Array | null>
  toPng: (width: number, height: number, rgba: Uint8Array) => Promise<Uint8Array>
  progress?: (page: number, done: number, total: number) => void
}

export interface OcrDone {
  bytes: Uint8Array
  words: number
  skipped: number
  pagesDone: number
  /** Mean confidence over the pages recognised, 0 to 100. */
  confidence: number
  /** No page needed recognising (every page already has text). */
  nothingToDo: boolean
  /** Places that look like tables. */
  tables: TableHint[]
  /** Page pictures taken out (replace output). */
  imagesRemoved: number
}

/** Recognises the text on pages of a document and writes it back as an invisible layer. */
export async function ocrDocument(bytes: Uint8Array, o: OcrRun, d: OcrDeps): Promise<OcrDone> {
  const list: number[] = []
  for (let p = 0; p < d.pages.length; p++) {
    if (o.pages && !o.pages.includes(p)) continue
    if (o.scope === 'blank' && (await d.client.pageText(p)).text.trim().length > 20) continue
    list.push(p)
  }
  if (!list.length) return { bytes, words: 0, skipped: 0, pagesDone: 0, confidence: 0, nothingToDo: true, tables: [], imagesRemoved: 0 }
  const inputs: OcrInput[] = []
  let confidence = 0
  for (const [i, p] of list.entries()) {
    d.progress?.(p, i + 1, list.length)
    const size = d.pages[p]
    const rendered = await d.client.render(p, Math.min(o.dpi / 72, Math.sqrt(40_000_000 / (size.width * size.height))))
    const res = await d.recognise(await d.toPng(rendered.width, rendered.height, rendered.data), o.languages)
    confidence += res.confidence
    inputs.push({ page: p, scale: rendered.width / size.width, lines: res.lines })
  }
  // Non-Latin languages need an installed font that has their letters.
  let font: Uint8Array | null = null
  for (const family of fontsForLanguages(o.languages)) {
    font = await d.findFont(family).catch(() => null)
    if (font) break
  }
  const replace = o.output === 'replace'
  const out = await addTextLayer(bytes, inputs, font, replace)
  let final = out.bytes
  let imagesRemoved = 0
  if (replace) {
    const r = await removeScanImages(final, inputs.map((i) => i.page))
    final = r.bytes
    imagesRemoved = r.removed
  }
  const tables = inputs.flatMap((i) => findTables(i.page, i.lines))
  return { bytes: final, words: out.words, skipped: out.skipped, pagesDone: inputs.length, confidence: confidence / inputs.length, nothingToDo: false, tables, imagesRemoved }
}

/**
 * Takes the page-sized pictures (a scan) out of the pages' content: pictures that cover at least `coverage` of the page.
 * Smaller pictures (logos, stamps) stay. Used when the recognised text replaces the scan.
 */
export async function removeScanImages(bytes: Uint8Array, pages: number[], coverage = 0.5): Promise<{ bytes: Uint8Array; removed: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  let removed = 0
  for (const p of pages) {
    const page = doc.getPage(p)
    const src = pageContent(page)
    const ops = parseContent(src)
    const { width, height } = page.getSize()
    const drop = new Set<number>()
    for (const d of imageDraws(ops, (n) => isImageXObject(page, n))) {
      const w = Math.hypot(d.ctm[0], d.ctm[1])
      const h = Math.hypot(d.ctm[2], d.ctm[3])
      if ((w * h) / (width * height) >= coverage) drop.add(d.index)
    }
    if (!drop.size) continue
    const out = removeOps(src, ops, drop)
    setPageContent(doc, page, out)
    removed += drop.size
    // The picture itself goes too when nothing on the page draws it any more.
    const names = new Set(
      [...drop].map((i) => ops[i]).filter((o) => o.op === 'Do' && o.operands[0]?.t === 'name').map((o) => (o.operands[0] as { v: string }).v)
    )
    const stillUsed = new Set(parseContent(out).filter((o) => o.op === 'Do' && o.operands[0]?.t === 'name').map((o) => (o.operands[0] as { v: string }).v))
    const xo = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    for (const n of names) if (!stillUsed.has(n)) xo?.delete(PDFName.of(n))
  }
  if (removed) pruneUnreachable(doc)
  return { bytes: removed ? await doc.save() : bytes, removed }
}
