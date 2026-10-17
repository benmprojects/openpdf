/**
 * Replace fonts across a document: every use of a named font is switched to a standard font or an installed one.
 * The font dictionary is rewritten in place, so every page and form that used it changes together. This works for
 * simple fonts whose codes follow WinAnsi (the usual case for Western text). Glyph widths come from the new font, so
 * the letters of a line are spaced differently; a metric-compatible choice (Arial for Helvetica, Times New Roman for
 * Times) keeps the layout. Fonts with their own character codes (symbol fonts, custom encodings) and two-byte (CID)
 * fonts are refused and listed, because their codes mean nothing to another font.
 */
import { PDFDict, PDFDocument, PDFName, type StandardFonts } from 'pdf-lib'
import { fontKey } from '../../shared/fontMatch'
import { embedSimpleFont } from './pdfa'
import { pruneUnreachable } from './redact'
import { fontIsEmbedded, fontName, fontsOf } from './standards'
import { standardFor, type StandardFamily } from './textEdit'

const N = PDFName.of

export interface DocFont {
  /** The font's name without a subset prefix. */
  name: string
  subtype: string
  embedded: boolean
  /** How many font dictionaries carry this name. */
  uses: number
  /** Whether it can be replaced, and if not why. */
  replaceable: boolean
  reason: string
}

export type FontTarget =
  | { kind: 'standard'; family: Exclude<StandardFamily, 'symbol' | 'zapf'>; bold: boolean; italic: boolean }
  | { kind: 'installed'; family: string; bold: boolean; italic: boolean }

export interface FontRule {
  from: string
  to: FontTarget
}

/** Why a font cannot be replaced, or '' when it can. */
export function replaceProblem(f: PDFDict): string {
  const sub = (f.lookup(N('Subtype')) as PDFName | undefined)?.decodeText()
  if (sub === 'Type3') return 'Type 3 fonts are drawn by the file itself'
  if (sub === 'Type0') return 'Two-byte (CID) fonts cannot be replaced: their codes mean nothing to another font'
  if (sub !== 'Type1' && sub !== 'TrueType' && sub !== 'MMType1') return 'Not a simple font'
  const e = f.lookup(N('Encoding'))
  const embedded = fontIsEmbedded(f)
  if (e === undefined) return embedded ? 'Uses the font’s own character codes' : ''
  if (e === N('WinAnsiEncoding')) return ''
  if (e === N('MacRomanEncoding') || e === N('StandardEncoding')) return ''
  if (e instanceof PDFDict && !e.has(N('Differences')) && (!e.has(N('BaseEncoding')) || e.lookup(N('BaseEncoding')) === N('WinAnsiEncoding'))) return ''
  return 'Uses a custom encoding (Differences)'
}

/** The fonts of a document, grouped by name. */
export async function listDocumentFonts(bytes: Uint8Array): Promise<DocFont[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const by = new Map<string, DocFont>()
  for (const f of fontsOf(doc)) {
    const name = fontName(f)
    const problem = replaceProblem(f)
    const prev = by.get(name)
    if (prev) {
      prev.uses++
      if (problem && prev.replaceable) {
        prev.replaceable = false
        prev.reason = problem
      }
      continue
    }
    by.set(name, { name, subtype: (f.lookup(N('Subtype')) as PDFName | undefined)?.decodeText() ?? '', embedded: fontIsEmbedded(f), uses: 1, replaceable: !problem, reason: problem })
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** A target that keeps the layout: the metric twin of a standard family, else the same family name. */
export function suggestTarget(name: string): FontTarget {
  const k = fontKey(name)
  const bold = k.bold
  const italic = k.italic
  if (/^(helvetica|arial|arialmt)$/.test(k.family)) return { kind: 'installed', family: 'Arial', bold, italic }
  if (/^(times|timesnewroman|timesnewromanps)$/.test(k.family)) return { kind: 'installed', family: 'Times New Roman', bold, italic }
  if (/^(courier|couriernew|couriernewps)$/.test(k.family)) return { kind: 'installed', family: 'Courier New', bold, italic }
  return { kind: 'standard', family: 'helvetica', bold, italic }
}

export interface ReplaceResult {
  bytes: Uint8Array
  replaced: number
  refused: { name: string; reason: string }[]
  /** Fonts for which no installed font was found. */
  missing: string[]
}

/** Applies the rules. `fontFor` finds an installed font file for a family and style (the app passes its font finder). */
export async function replaceFonts(bytes: Uint8Array, rules: FontRule[], fontFor: (family: string, bold: boolean, italic: boolean) => Promise<Uint8Array | null>): Promise<ReplaceResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const refused = new Map<string, string>()
  const missing = new Set<string>()
  let replaced = 0
  const byName = new Map(rules.map((r) => [r.from, r.to]))
  for (const f of fontsOf(doc)) {
    const name = fontName(f)
    const to = byName.get(name)
    if (!to) continue
    const problem = replaceProblem(f)
    if (problem) {
      refused.set(name, problem)
      continue
    }
    if (to.kind === 'standard') {
      const std: StandardFonts = standardFor(to.family, to.bold, to.italic)
      const keepEncoding = f.lookup(N('Encoding'))
      const toUnicode = f.get(N('ToUnicode'))
      for (const k of [...f.keys()]) f.delete(k)
      f.set(N('Type'), N('Font'))
      f.set(N('Subtype'), N('Type1'))
      f.set(N('BaseFont'), N(std))
      if (keepEncoding instanceof PDFName) f.set(N('Encoding'), keepEncoding)
      else if (keepEncoding instanceof PDFDict) f.set(N('Encoding'), N('WinAnsiEncoding'))
      if (toUnicode) f.set(N('ToUnicode'), toUnicode)
      replaced++
    } else {
      const enc = f.lookup(N('Encoding'))
      if (enc === N('MacRomanEncoding') || enc === N('StandardEncoding')) {
        refused.set(name, 'Installed fonts are written with WinAnsi codes; this font uses another encoding. Choose a standard font instead.')
        continue
      }
      const data = await fontFor(to.family, to.bold, to.italic).catch(() => null)
      if (!data) {
        missing.add(name)
        continue
      }
      const old = [...f.entries()]
      const toUnicode = f.get(N('ToUnicode'))
      for (const k of [...f.keys()]) f.delete(k)
      f.set(N('Type'), N('Font'))
      if (embedSimpleFont(doc, f, data)) {
        if (toUnicode) f.set(N('ToUnicode'), toUnicode)
        replaced++
      } else {
        // Not a TrueType file we can use: put the font back as it was.
        for (const k of [...f.keys()]) f.delete(k)
        for (const [k, v] of old) f.set(k, v)
        missing.add(name)
      }
    }
  }
  if (replaced) pruneUnreachable(doc)
  return { bytes: replaced ? await doc.save() : bytes, replaced, refused: [...refused].map(([name, reason]) => ({ name, reason })), missing: [...missing] }
}
