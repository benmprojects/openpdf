/**
 * Convert a document towards PDF/A-2b (ISO 19005-2), best effort. What it does: identifies the file as PDF/A in its
 * XMP metadata (kept in step with the Info entries), adds an sRGB output intent, embeds installed fonts in place of
 * the standard 14 and other fonts that are not embedded (whole font files, for simple fonts with a WinAnsi
 * encoding), removes JavaScript and attached files, sets annotation flags, and writes a file identifier. What it
 * cannot do is reported: fonts it has no match for, CMYK colour, annotations with no appearance. It is not
 * a validator, and the result should be checked with one (veraPDF) before it is relied on.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib'
import { fontKey } from '../../shared/fontMatch'
import { parseContent } from './content'
import { srgbIccProfile } from './iccProfile'
import { buildXmp, EMPTY_PROPS, pdfDateToIso, type DocProps } from './metadata'
import { pageContent, xobjectDict } from './pageContent'
import { sanitise } from './sanitise'
import { fontIsEmbedded, fontName, fontsOf } from './standards'

const N = PDFName.of

export interface PdfAReport {
  fixed: string[]
  remaining: string[]
}

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
function embedSimpleFont(doc: PDFDocument, dict: PDFDict, data: Uint8Array): boolean {
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
function encodingFine(font: PDFDict): boolean {
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

/**
 * Brings a document as close to PDF/A-2b as this program can. `fontFor` finds an installed font file for a family
 * (the app passes its font finder), or null.
 */
export async function convertToPdfA(
  bytes: Uint8Array,
  fontFor: (family: string, bold: boolean, italic: boolean) => Promise<Uint8Array | null>,
  now = new Date()
): Promise<{ bytes: Uint8Array; report: PdfAReport }> {
  const report: PdfAReport = { fixed: [], remaining: [] }
  const cleaned = await sanitise(bytes, { metadata: false, attachments: true, javascript: true, comments: false, bookmarks: false, thumbnails: false })
  if (cleaned.removed.javascript) report.fixed.push(`Removed ${cleaned.removed.javascript} script${cleaned.removed.javascript === 1 ? '' : 's'} and action${cleaned.removed.javascript === 1 ? '' : 's'}`)
  if (cleaned.removed.attachments) report.fixed.push(`Removed ${cleaned.removed.attachments} attached file${cleaned.removed.attachments === 1 ? '' : 's'}`)

  const doc = await PDFDocument.load(cleaned.bytes, { updateMetadata: false })
  const ctx = doc.context

  // Fonts.
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

  // Info, dates and XMP.
  let info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict)
  if (!info) {
    const ref = ctx.register(ctx.obj({}))
    ctx.trailerInfo.Info = ref
    info = ctx.lookupMaybe(ref, PDFDict)!
  }
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
  const pdfDate = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  }
  if (!info.has(N('CreationDate'))) info.set(N('CreationDate'), PDFString.of(pdfDate(now)))
  info.set(N('ModDate'), PDFString.of(pdfDate(now)))
  props.created = pdfDateToIso(text(info.lookup(N('CreationDate'))))
  props.modified = pdfDateToIso(text(info.lookup(N('ModDate'))))
  const xmp = ctx.stream(new TextEncoder().encode(buildXmp(props, { part: 2, conformance: 'B' })), { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(N('Metadata'), ctx.register(xmp))
  report.fixed.push('Marked the file as PDF/A-2b in its metadata')

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

  // File identifier.
  if (!ctx.trailerInfo.ID) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
    ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)])
    report.fixed.push('Added a file identifier')
  }

  // Annotations: printable, visible, and (where it matters) with an appearance.
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

  // Optional content: the default configuration may not switch layers automatically.
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

  if (usesCmyk(doc)) report.remaining.push('The pages use CMYK colour, which needs a CMYK output intent')
  report.remaining.push('Not checked: colour spaces, transparency details, glyph coverage, metadata schemas. Validate with veraPDF before relying on it.')

  return { bytes: await doc.save(), report }
}
