/**
 * Convert a document towards PDF/A-2b (ISO 19005-2), best effort. What it does: identifies the file as PDF/A in its
 * XMP metadata (kept in step with the Info entries), adds an sRGB output intent, embeds installed fonts in place of
 * the standard 14 and other fonts that are not embedded (whole font files, for simple fonts with a WinAnsi
 * encoding), removes JavaScript and attached files, sets annotation flags, and writes a file identifier. What it
 * cannot do is reported: fonts it has no match for, CMYK colour, annotations with no appearance. It is not
 * a validator, and the result should be checked with one (veraPDF) before it is relied on.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, type PDFObject } from 'pdf-lib'
import { fontKey } from '../../shared/fontMatch'
import { parseContent } from './content'
import { contentScopes } from './docStreams'
import { flattenSoftMasks } from './imageMasks'
import { flattenLayers } from './layersEdit'
import { srgbIccProfile } from './iccProfile'
import { buildXmp, EMPTY_PROPS, pdfDateToIso, type DocProps } from './metadata'
import { pageContent, xobjectDict } from './pageContent'
import { sanitise } from './sanitise'
import { fontIsEmbedded, fontName, fontsOf } from './standards'

const N = PDFName.of

export interface PdfAReport {
  fixed: string[]
  remaining: string[]
  /** What the conversion aimed at, for headings, e.g. "PDF/A-2b". */
  target?: string
}

/** The parts of ISO 19005 this program can aim at (conformance level B in each). */
export type PdfAPart = 1 | 2 | 3

/** Which installed family to embed in place of a PDF font, and its style. The standard 14 map to their metric twins. */
export function substitute(pdfName: string): { family: string; bold: boolean; italic: boolean } {
  const k = fontKey(pdfName)
  const family = /^(helvetica|arial|arialmt)$/.test(k.family) ? 'Arial' : /^(times|timesnewroman|timesnewromanps)$/.test(k.family) ? 'Times New Roman' : /^(courier|couriernew|couriernewps)$/.test(k.family) ? 'Courier New' : pdfName.replace(/^[A-Z]{6}\+/, '')
  return { family, bold: k.bold, italic: k.italic }
}

const text = (o: unknown): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** Fonts whose file is an OpenType font with TrueType outlines or a plain TrueType file (what FontFile2 holds). */
const isTrueType = (d: Uint8Array) => (d[0] === 0 && d[1] === 1 && d[2] === 0 && d[3] === 0) || String.fromCharCode(d[0], d[1], d[2], d[3]) === 'true'

type Fontkit = ReturnType<typeof fontkit.create>

/** Replaces a simple font that is not embedded with an embedded TrueType one drawn with the same codes. */
export function embedSimpleFont(doc: PDFDocument, dict: PDFDict, data: Uint8Array): boolean {
  if (!isTrueType(data)) return false
  const f = fontkit.create(data as never) as Fontkit
  if ('fonts' in f) return false
  const ctx = doc.context
  const upm = f.unitsPerEm || 1000
  const decode = new TextDecoder('windows-1252')
  const widths: number[] = []
  for (let code = 32; code <= 255; code++) {
    const ch = decode.decode(Uint8Array.of(code))
    const cp = ch.codePointAt(0) ?? 0
    const glyph = cp >= 32 ? f.glyphForCodePoint(cp) : null
    widths.push(glyph ? Math.round((glyph.advanceWidth * 1000) / upm) : 0)
  }
  const scale = (v: number) => Math.round((v * 1000) / upm)
  const bbox = f.bbox
  const fixed = (f as unknown as { post?: { isFixedPitch?: number } }).post?.isFixedPitch
  const flags = 32 | (f.italicAngle ? 64 : 0) | (fixed ? 1 : 0)
  const fontFile = ctx.register(ctx.flateStream(data, { Length1: data.length }))
  const psName = (f.postscriptName || 'EmbeddedFont').replace(/[^A-Za-z0-9-]/g, '')
  const descriptor = ctx.register(
    ctx.obj({
      Type: 'FontDescriptor',
      FontName: psName,
      Flags: flags,
      FontBBox: [scale(bbox.minX), scale(bbox.minY), scale(bbox.maxX), scale(bbox.maxY)],
      ItalicAngle: f.italicAngle || 0,
      Ascent: scale(f.ascent),
      Descent: scale(f.descent),
      CapHeight: scale(f.capHeight || f.ascent * 0.7),
      StemV: /bold/i.test(f.postscriptName || '') ? 120 : 80,
      FontFile2: fontFile
    })
  )
  dict.set(N('Subtype'), N('TrueType'))
  dict.set(N('BaseFont'), N(psName))
  dict.set(N('FirstChar'), PDFNumber.of(32))
  dict.set(N('LastChar'), PDFNumber.of(255))
  dict.set(N('Widths'), ctx.obj(widths))
  dict.set(N('FontDescriptor'), descriptor)
  dict.set(N('Encoding'), N('WinAnsiEncoding'))
  return true
}

/** Whether a simple font's encoding is one we can keep when embedding (WinAnsi, MacRoman, or none). */
export function encodingFine(font: PDFDict): boolean {
  const e = font.lookup(N('Encoding'))
  if (e === undefined || e === N('WinAnsiEncoding') || e === N('MacRomanEncoding')) return true
  if (e instanceof PDFDict) return !e.has(N('Differences')) && (!e.has(N('BaseEncoding')) || e.lookup(N('BaseEncoding')) === N('WinAnsiEncoding'))
  return false
}

/** True when a page's content uses CMYK colour operators or colour spaces. */
function usesCmyk(doc: PDFDocument): boolean {
  for (const page of doc.getPages()) {
    for (const o of parseContent(pageContent(page))) {
      if (o.op === 'k' || o.op === 'K') return true
      if ((o.op === 'cs' || o.op === 'CS') && o.operands[0]?.t === 'name' && o.operands[0].v === 'DeviceCMYK') return true
    }
    const xo = xobjectDict(page)
    if (xo)
      for (const k of xo.keys()) {
        const x = xo.lookup(k)
        if (x instanceof PDFRawStream && x.dict.lookup(N('ColorSpace')) === N('DeviceCMYK')) return true
      }
  }
  return false
}

export type FontFinder = (family: string, bold: boolean, italic: boolean) => Promise<Uint8Array | null>

/** "D:YYYYMMDDHHmmSSZ" for a date. */
export function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

/** The Info dictionary, made if the file has none. */
export function infoDictOf(doc: PDFDocument): PDFDict {
  const ctx = doc.context
  let info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict)
  if (!info) {
    const ref = ctx.register(ctx.obj({}))
    ctx.trailerInfo.Info = ref
    info = ctx.lookupMaybe(ref, PDFDict)!
  }
  return info
}

/** Sets the minor version in the first line of a file (%PDF-1.x). pdf-lib always writes 1.7. */
export function setHeaderVersion(bytes: Uint8Array, minor: number): Uint8Array {
  const head = String.fromCharCode(...bytes.subarray(0, 8))
  if (!/^%PDF-1\.\d$/.test(head)) return bytes
  const out = bytes.slice()
  out[7] = 0x30 + minor
  return out
}

/** Embeds fonts, adds missing CID glyph maps and gives pages their own resources. Shared by the PDF/A and PDF/X conversions. */
export async function repairFontsAndResources(doc: PDFDocument, fontFor: FontFinder, report: PdfAReport): Promise<void> {
  const loose = fontsOf(doc).filter((f) => !fontIsEmbedded(f))
  let embedded = 0
  const cannot = new Set<string>()
  for (const f of loose) {
    const name = fontName(f)
    const sub = f.lookup(N('Subtype'))
    if ((sub !== N('Type1') && sub !== N('TrueType') && sub !== N('MMType1')) || !encodingFine(f)) {
      cannot.add(name)
      continue
    }
    const want = substitute((f.lookup(N('BaseFont')) as PDFName | undefined)?.decodeText() ?? name)
    const data = await fontFor(want.family, want.bold, want.italic).catch(() => null)
    if (data && embedSimpleFont(doc, f, data)) embedded++
    else cannot.add(name)
  }
  if (embedded) report.fixed.push(`Embedded ${embedded} font${embedded === 1 ? '' : 's'}`)
  if (cannot.size) report.remaining.push(`Fonts that could not be embedded: ${[...cannot].slice(0, 6).join(', ')}${cannot.size > 6 ? ` and ${cannot.size - 6} more` : ''}`)

  // CID fonts that are TrueType need an explicit glyph map (the default is the identity map, so this changes nothing).
  let cidFixed = 0
  for (const f of fontsOf(doc)) {
    const desc = f.lookupMaybe(N('DescendantFonts'), PDFArray)?.lookupMaybe(0, PDFDict)
    if (desc && desc.lookup(N('Subtype')) === N('CIDFontType2') && !desc.has(N('CIDToGIDMap'))) {
      desc.set(N('CIDToGIDMap'), N('Identity'))
      cidFixed++
    }
  }
  if (cidFixed) report.fixed.push(`Added a glyph map to ${cidFixed} CID font${cidFixed === 1 ? '' : 's'}`)

  // Every page needs resources of its own, not ones inherited from the page tree.
  let ownResources = 0
  for (const page of doc.getPages()) {
    if (page.node.has(N('Resources'))) continue
    for (let node: PDFDict | undefined = page.node.lookupMaybe(N('Parent'), PDFDict), i = 0; node && i < 32; node = node.lookupMaybe(N('Parent'), PDFDict), i++) {
      const res = node.get(N('Resources'))
      if (res) {
        page.node.set(N('Resources'), res)
        ownResources++
        break
      }
    }
  }
  if (ownResources) report.fixed.push(`Gave ${ownResources} page${ownResources === 1 ? '' : 's'} their own resources`)
}

/** Reads the Info entries into DocProps, adds a creation date when missing, and sets the modification date. */
export function propsFromInfo(info: PDFDict, now: Date): DocProps {
  const props: DocProps = { ...EMPTY_PROPS }
  const keys: [keyof DocProps, string][] = [
    ['title', 'Title'],
    ['author', 'Author'],
    ['subject', 'Subject'],
    ['keywords', 'Keywords'],
    ['creator', 'Creator'],
    ['producer', 'Producer']
  ]
  for (const [k, key] of keys) props[k] = text(info.lookup(N(key)))
  if (!info.has(N('CreationDate'))) info.set(N('CreationDate'), PDFString.of(pdfDate(now)))
  info.set(N('ModDate'), PDFString.of(pdfDate(now)))
  props.created = pdfDateToIso(text(info.lookup(N('CreationDate'))))
  props.modified = pdfDateToIso(text(info.lookup(N('ModDate'))))
  return props
}

/** Adds a file identifier when there is none. */
export function ensureFileId(doc: PDFDocument, report: PdfAReport): void {
  const ctx = doc.context
  if (ctx.trailerInfo.ID) return
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)])
  report.fixed.push('Added a file identifier')
}

/** Annotations: printable, not hidden or no-view; counts the ones with no appearance. */
export function fixAnnotations(doc: PDFDocument, report: PdfAReport): void {
  let flagged = 0
  let noAppearance = 0
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict)
      if (!a) continue
      const sub = (a.lookup(N('Subtype')) as PDFName | undefined)?.decodeText()
      const flags = a.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0
      const fixed = (flags | 4) & ~(2 | 32)
      if (fixed !== flags) {
        a.set(N('F'), PDFNumber.of(fixed))
        flagged++
      }
      if (sub !== 'Popup' && sub !== 'Link' && !a.has(N('AP'))) noAppearance++
    }
  }
  if (flagged) report.fixed.push(`Corrected the flags of ${flagged} annotation${flagged === 1 ? '' : 's'}`)
  if (noAppearance) report.remaining.push(`${noAppearance} annotation${noAppearance === 1 ? ' has' : 's have'} no appearance`)
}

/** Transparency in a document: soft masks, opacity or blend modes in graphics states, and page transparency groups. */
export function findTransparency(doc: PDFDocument): { states: number; softMasks: number; groups: number } {
  let states = 0
  let softMasks = 0
  let groups = 0
  const seen = new Set<PDFDict>()
  const visit = (res: PDFDict | undefined, depth: number): void => {
    if (!res || seen.has(res) || depth > 6) return
    seen.add(res)
    const gs = res.lookupMaybe(N('ExtGState'), PDFDict)
    for (const k of gs?.keys() ?? []) {
      const g = gs!.lookupMaybe(k, PDFDict)
      if (!g) continue
      const ca = g.lookupMaybe(N('ca'), PDFNumber)?.asNumber()
      const CA = g.lookupMaybe(N('CA'), PDFNumber)?.asNumber()
      const bm = g.lookup(N('BM'))
      const sm = g.lookup(N('SMask'))
      if ((ca !== undefined && ca < 1) || (CA !== undefined && CA < 1) || (bm instanceof PDFName && bm !== N('Normal') && bm !== N('Compatible')) || (sm && sm !== N('None'))) states++
    }
    const xo = res.lookupMaybe(N('XObject'), PDFDict)
    for (const k of xo?.keys() ?? []) {
      const x = xo!.lookup(k)
      if (!(x instanceof PDFRawStream)) continue
      if (x.dict.has(N('SMask'))) softMasks++
      if (x.dict.lookup(N('Subtype')) === N('Form')) {
        if (x.dict.lookupMaybe(N('Group'), PDFDict)?.lookup(N('S')) === N('Transparency')) groups++
        visit(x.dict.lookupMaybe(N('Resources'), PDFDict), depth + 1)
      }
    }
  }
  for (const page of doc.getPages()) {
    if (page.node.lookupMaybe(N('Group'), PDFDict)?.lookup(N('S')) === N('Transparency')) groups++
    visit(page.node.Resources(), 0)
  }
  return { states, softMasks, groups }
}

/** True when the file uses filters PDF/A-1 does not allow (LZW). */
function usesLzw(doc: PDFDocument): boolean {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const f = obj.dict.lookup(N('Filter'))
      if (f === N('LZWDecode')) return true
      if (f instanceof PDFArray) for (let i = 0; i < f.size(); i++) if (f.lookup(i) === N('LZWDecode')) return true
    }
  }
  return false
}

/** Gives one file specification what PDF/A-3 wants: a relationship, names in both forms, and a typed, dated file stream. */
function describeSpec(ctx: PDFDocument['context'], spec: PDFDict): void {
  if (!spec.has(N('AFRelationship'))) spec.set(N('AFRelationship'), N('Unspecified'))
  const ef = spec.lookupMaybe(N('EF'), PDFDict)
  const fileStream = ef?.lookup(N('F'))
  if (fileStream instanceof PDFRawStream) {
    if (!fileStream.dict.has(N('Subtype'))) fileStream.dict.set(N('Subtype'), N('application#2Foctet-stream'))
    let params = fileStream.dict.lookupMaybe(N('Params'), PDFDict)
    if (!params) {
      params = ctx.obj({}) as PDFDict
      fileStream.dict.set(N('Params'), params)
    }
    if (!params.has(N('ModDate'))) params.set(N('ModDate'), PDFString.of(pdfDate(new Date())))
  }
  if (ef && !ef.has(N('UF')) && ef.has(N('F'))) ef.set(N('UF'), ef.get(N('F'))!)
  const f = spec.lookup(N('F'))
  if (!spec.has(N('UF')) && (f instanceof PDFString || f instanceof PDFHexString)) spec.set(N('UF'), PDFHexString.fromText(f.decodeText()))
  if (!spec.has(N('F')) && spec.has(N('UF'))) spec.set(N('F'), spec.get(N('UF'))!)
}

/**
 * Makes every attached file PDF/A-3 ready: each file specification is an indirect object with a relationship, names in
 * both forms and a typed, dated file stream; those in the name tree are listed in the catalogue's /AF, and those of
 * file attachment annotations in the annotation's own /AF.
 */
export function prepareAttachmentsForA3(doc: PDFDocument, report: PdfAReport): void {
  const ctx = doc.context
  const refs: PDFObject[] = []
  const root = doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict)
  const walk = (node: PDFDict, depth: number): void => {
    if (depth > 12) return
    const list = node.lookupMaybe(N('Names'), PDFArray)
    for (let i = 1; list && i < list.size(); i += 2) {
      const d = list.lookupMaybe(i, PDFDict)
      if (!d) continue
      describeSpec(ctx, d)
      let ref = list.get(i)
      if (!(ref instanceof PDFRef)) {
        ref = ctx.register(d)
        list.set(i, ref)
      }
      refs.push(ref)
    }
    const kids = node.lookupMaybe(N('Kids'), PDFArray)
    for (let i = 0; kids && i < kids.size(); i++) {
      const k = kids.lookupMaybe(i, PDFDict)
      if (k) walk(k, depth + 1)
    }
  }
  if (root) walk(root, 0)
  let onAnnots = 0
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    for (let i = 0; annots && i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict)
      if (!a || a.lookup(N('Subtype')) !== N('FileAttachment')) continue
      const fs = a.lookupMaybe(N('FS'), PDFDict)
      if (!fs) continue
      describeSpec(ctx, fs)
      let ref = a.get(N('FS'))
      if (!(ref instanceof PDFRef)) {
        ref = ctx.register(fs)
        a.set(N('FS'), ref)
      }
      a.set(N('AF'), ctx.obj([ref]))
      onAnnots++
    }
  }
  if (refs.length) doc.catalog.set(N('AF'), ctx.obj(refs))
  const n = refs.length + onAnnots
  if (n) report.fixed.push(`Described ${n} attached file${n === 1 ? '' : 's'} for PDF/A-3 (relationship set to Unspecified: change it if the file is a source or data file)`)
}

const FORBIDDEN_ANNOTS: Record<PdfAPart, Set<string>> = {
  1: new Set(['Sound', 'Movie', 'Screen', '3D', 'RichMedia', 'FileAttachment', 'Watermark']),
  2: new Set(['Sound', 'Movie', 'Screen', '3D', 'RichMedia']),
  3: new Set(['Sound', 'Movie', 'Screen', '3D', 'RichMedia'])
}
const ANNOT_TYPES = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'FileAttachment', 'Sound', 'Movie', 'Widget', 'Screen', 'PrinterMark', 'TrapNet', 'Watermark', '3D', 'Redact', 'RichMedia'])
/** The annotation types PDF 1.4 defines, the only ones PDF/A-1 allows (besides what its own rules forbid). */
const ANNOT_TYPES_14 = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Ink', 'Popup', 'Widget', 'PrinterMark', 'TrapNet'])

/** Removes annotation types the part does not allow (and types the standard does not define). Returns how many. */
export function removeForbiddenAnnotations(doc: PDFDocument, part: PdfAPart): number {
  let removed = 0
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    if (!annots) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookupMaybe(i, PDFDict)
      const sub = (a?.lookup(N('Subtype')) as PDFName | undefined)?.decodeText()
      if (sub && (FORBIDDEN_ANNOTS[part].has(sub) || !(part === 1 ? ANNOT_TYPES_14 : ANNOT_TYPES).has(sub))) {
        annots.remove(i)
        removed++
      }
    }
  }
  return removed
}

/** PDF/A-1: opacity, blend modes and soft masks in graphics states are set to their plain values; transparency groups are removed. Returns what was changed. */
export function flattenGraphicsStateTransparency(doc: PDFDocument): { states: number; groups: number } {
  let states = 0
  let groups = 0
  const seen = new Set<PDFDict>()
  const visit = (res: PDFDict | undefined, depth: number): void => {
    if (!res || seen.has(res) || depth > 6) return
    seen.add(res)
    const gs = res.lookupMaybe(N('ExtGState'), PDFDict)
    for (const k of gs?.keys() ?? []) {
      const g = gs!.lookupMaybe(k, PDFDict)
      if (!g) continue
      let changed = false
      for (const key of ['ca', 'CA']) {
        const v = g.lookupMaybe(N(key), PDFNumber)?.asNumber()
        if (v !== undefined && v < 1) {
          g.set(N(key), PDFNumber.of(1))
          changed = true
        }
      }
      const bm = g.lookup(N('BM'))
      if (bm instanceof PDFName && bm !== N('Normal') && bm !== N('Compatible')) {
        g.set(N('BM'), N('Normal'))
        changed = true
      }
      const sm = g.lookup(N('SMask'))
      if (sm && sm !== N('None')) {
        g.set(N('SMask'), N('None'))
        changed = true
      }
      if (changed) states++
    }
    const xo = res.lookupMaybe(N('XObject'), PDFDict)
    for (const k of xo?.keys() ?? []) {
      const x = xo!.lookup(k)
      if (x instanceof PDFRawStream && x.dict.lookup(N('Subtype')) === N('Form')) {
        if (x.dict.lookupMaybe(N('Group'), PDFDict)?.lookup(N('S')) === N('Transparency')) {
          x.dict.delete(N('Group'))
          groups++
        }
        visit(x.dict.lookupMaybe(N('Resources'), PDFDict), depth + 1)
      }
    }
  }
  for (const page of doc.getPages()) {
    if (page.node.lookupMaybe(N('Group'), PDFDict)?.lookup(N('S')) === N('Transparency')) {
      page.node.delete(N('Group'))
      groups++
    }
  }
  // Pages, forms, patterns and annotation appearances.
  for (const scope of contentScopes(doc)) {
    if (scope.dict?.lookupMaybe(N('Group'), PDFDict)?.lookup(N('S')) === N('Transparency')) {
      scope.dict.delete(N('Group'))
      groups++
    }
    visit(scope.resources, 0)
  }
  return { states, groups }
}

/**
 * Brings a document as close to PDF/A-1b, 2b or 3b as this program can. `fontFor` finds an installed font file for a
 * family (the app passes its font finder), or null. Everything it could not do is in `report.remaining`.
 */
export async function convertToPdfA(bytes: Uint8Array, fontFor: FontFinder, now = new Date(), part: PdfAPart = 2): Promise<{ bytes: Uint8Array; report: PdfAReport }> {
  const report: PdfAReport = { fixed: [], remaining: [], target: `PDF/A-${part}b` }
  // Part 3 may carry any attached file; parts 1 and 2 may not (or only PDF/A ones, which this does not check).
  let source = bytes
  if (part === 1) {
    // PDF/A-1 has no layers: they are made permanent as they open (hidden content is removed).
    const flat = await flattenLayers(bytes)
    if (flat.layers) {
      source = flat.bytes
      report.fixed.push(`Flattened ${flat.layers} layer${flat.layers === 1 ? '' : 's'} as they open: ${flat.change.removed} hidden piece${flat.change.removed === 1 ? '' : 's'} of content removed`)
    }
  }
  const cleaned = await sanitise(source, { metadata: false, attachments: part !== 3, javascript: true, comments: false, bookmarks: false, thumbnails: false })
  if (cleaned.removed.javascript) report.fixed.push(`Removed ${cleaned.removed.javascript} script${cleaned.removed.javascript === 1 ? '' : 's'} and action${cleaned.removed.javascript === 1 ? '' : 's'}`)
  if (cleaned.removed.attachments) report.fixed.push(`Removed ${cleaned.removed.attachments} attached file${cleaned.removed.attachments === 1 ? '' : 's'}`)

  const doc = await PDFDocument.load(cleaned.bytes, { updateMetadata: false })
  const ctx = doc.context
  await repairFontsAndResources(doc, fontFor, report)

  const info = infoDictOf(doc)
  const props = propsFromInfo(info, now)
  const xmp = ctx.stream(new TextEncoder().encode(buildXmp(props, { part, conformance: 'B' })), { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(N('Metadata'), ctx.register(xmp))
  report.fixed.push(`Marked the file as PDF/A-${part}b in its metadata`)

  // Output intent (sRGB).
  const profile = ctx.register(ctx.flateStream(srgbIccProfile(now), { N: 3, Alternate: 'DeviceRGB' }))
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: profile
  })
  doc.catalog.set(N('OutputIntents'), ctx.obj([ctx.register(intent)]))
  report.fixed.push('Added an sRGB output intent')

  ensureFileId(doc, report)
  fixAnnotations(doc, report)

  // Optional content: the default configuration may not switch layers automatically (PDF/A-1 has no layers at all).
  const oc = doc.catalog.lookupMaybe(N('OCProperties'), PDFDict)
  const d = oc?.lookupMaybe(N('D'), PDFDict)
  const configs = [d, ...(oc?.lookupMaybe(N('Configs'), PDFArray) ? Array.from({ length: oc!.lookupMaybe(N('Configs'), PDFArray)!.size() }, (_, i) => oc!.lookupMaybe(N('Configs'), PDFArray)!.lookupMaybe(i, PDFDict)) : [])]
  let unnamed = 0
  for (const c of configs) {
    if (c && !c.has(N('Name'))) {
      c.set(N('Name'), PDFString.of(c === d ? 'Default' : 'Configuration'))
      unnamed++
    }
  }
  if (unnamed) report.fixed.push('Named the layer configuration')
  if (d?.has(N('AS'))) {
    d.delete(N('AS'))
    report.fixed.push('Removed automatic layer switching')
  }

  const badAnnots = removeForbiddenAnnotations(doc, part)
  if (badAnnots) report.fixed.push(`Removed ${badAnnots} annotation${badAnnots === 1 ? '' : 's'} of a kind PDF/A-${part} does not allow (sound, video, 3D, attachments and the like)`)
  if (part === 3) prepareAttachmentsForA3(doc, report)
  if (part === 1) {
    const masks = await flattenSoftMasks(doc)
    if (masks.flattened) report.fixed.push(`Flattened ${masks.flattened} picture${masks.flattened === 1 ? '' : 's'} with transparency onto white`)
    const flat = flattenGraphicsStateTransparency(doc)
    if (flat.states || flat.groups) report.fixed.push(`Set ${flat.states} opacity, blend or mask setting${flat.states === 1 ? '' : 's'} to plain values and removed ${flat.groups} transparency group${flat.groups === 1 ? '' : 's'} (the look may change where they were used)`)
    const tr = findTransparency(doc)
    if (tr.states || tr.softMasks || tr.groups) report.remaining.push(`PDF/A-1 does not allow transparency: ${[tr.states && `${tr.states} opacity or blend setting${tr.states === 1 ? '' : 's'}`, tr.softMasks && `${tr.softMasks} soft mask${tr.softMasks === 1 ? '' : 's'}`, tr.groups && `${tr.groups} transparency group${tr.groups === 1 ? '' : 's'}`].filter(Boolean).join(', ')}. Rasterise the pages that use it, or use PDF/A-2b`)
    if (usesLzw(doc)) report.remaining.push('PDF/A-1 does not allow LZW compression')
  }

  if (usesCmyk(doc)) report.remaining.push('The pages use CMYK colour, which needs a CMYK output intent')
  report.remaining.push('Not checked: colour spaces, transparency details, glyph coverage, metadata schemas. Validate with veraPDF before relying on it.')

  // PDF/A-1 is built on PDF 1.4: no object streams, header 1.4.
  const saved = await doc.save({ useObjectStreams: part !== 1 })
  return { bytes: part === 1 ? setHeaderVersion(saved, 4) : saved, report }
}
