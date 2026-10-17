/**
 * PDF/X (ISO 15930) for print: a check and a best-effort conversion towards PDF/X-1a:2003 (CMYK and grey only, no
 * transparency, PDF 1.4) and PDF/X-4 (colour managed, transparency allowed, PDF 1.6). The conversion writes the
 * identification (Info, XMP), a title, the trapping flag, a TrimBox on every page, a file identifier and an output
 * intent; embeds installed fonts where it can; and for X-1a converts device colours to CMYK with the approximate
 * conversion in colourConvert.ts. It cannot guarantee conformance: it has no CMYK profile (X-1a names a registered
 * print condition instead of embedding one; X-4 embeds an sRGB profile), it does not flatten real transparency, and it
 * does not check images, overprint or trapping details. Preflight the result with a PDF/X preflight tool before it goes
 * to a printer.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib'
import { convertColours } from './colourConvert'
import { contentScopes } from './docStreams'
import { flattenSoftMasks } from './imageMasks'
import { iccIsRgb } from './pdfxLogic'
import { parseContent } from './content'
import { srgbIccProfile } from './iccProfile'
import { buildXmp } from './metadata'
import { ensureFileId, fixAnnotations, flattenGraphicsStateTransparency, findTransparency, infoDictOf, propsFromInfo, repairFontsAndResources, setHeaderVersion, type FontFinder, type PdfAReport } from './pdfa'
import { sanitise } from './sanitise'
import { fontIsEmbedded, fontsOf } from './standards'

const N = PDFName.of

export type PdfXVariant = 'x1a' | 'x4'

export const PDFX_LABEL: Record<PdfXVariant, string> = { x1a: 'PDF/X-1a:2003', x4: 'PDF/X-4' }

export interface PdfXCheck {
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail?: string
}

export interface PdfXOptions {
  /** The print condition named in the output intent (X-1a, which embeds no profile). */
  condition: string
  /** The registry that names it. */
  registry: string
}

export const DEFAULT_CONDITION: PdfXOptions = { condition: 'CGATS TR 001', registry: 'http://www.color.org' }

const text = (o: unknown): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** Whether the document uses RGB colour (operators, pictures or ICC based RGB spaces). */
function rgbUsage(doc: PDFDocument): number {
  let n = 0
  for (const scope of contentScopes(doc)) {
    const src = scope.get()
    for (const o of parseContent(src)) {
      if (o.op === 'rg' || o.op === 'RG') n++
      else if ((o.op === 'cs' || o.op === 'CS') && o.operands[0]?.t === 'name' && o.operands[0].v === 'DeviceRGB') n++
    }
    const xo = scope.resources?.lookupMaybe(N('XObject'), PDFDict)
    for (const k of xo?.keys() ?? []) {
      const x = xo!.lookup(k)
      if (x instanceof PDFRawStream && x.dict.lookup(N('Subtype')) === N('Image')) {
        const cs = x.dict.lookup(N('ColorSpace'))
        if (cs === N('DeviceRGB') || iccIsRgb(cs)) n++
      }
    }
  }
  return n
}

/** Checks a document against what PDF/X asks that can be tested from the file alone. This is not a preflight. */
export async function checkPdfX(bytes: Uint8Array, variant: PdfXVariant): Promise<PdfXCheck[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const out: PdfXCheck[] = []
  const add = (label: string, ok: boolean, detail?: string, warn = false) => out.push({ label, status: ok ? 'pass' : warn ? 'warn' : 'fail', detail })
  const info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict)
  const claimed = text(info?.lookup(N('GTS_PDFXVersion')))
  add(`Identified as ${PDFX_LABEL[variant]}`, claimed === PDFX_LABEL[variant], claimed ? `the file says ${claimed}` : 'the file does not say')
  add('Has a title', !!text(info?.lookup(N('Title'))).trim())
  const trapped = info?.lookup(N('Trapped'))
  add('Trapping is stated (True or False)', trapped === N('True') || trapped === N('False'))
  add('Has a file identifier', !!ctx.trailerInfo.ID)
  add('Not encrypted', !ctx.trailerInfo.Encrypt)
  const unembedded = fontsOf(doc).filter((f) => !fontIsEmbedded(f)).length
  add('Every font is embedded', unembedded === 0, unembedded ? `${unembedded} are not` : undefined)
  const intents = doc.catalog.lookupMaybe(N('OutputIntents'), PDFArray)
  let hasX = false
  for (let i = 0; i < (intents?.size() ?? 0); i++) if (intents!.lookupMaybe(i, PDFDict)?.lookup(N('S')) === N('GTS_PDFX')) hasX = true
  add('Has a PDF/X output intent', hasX)
  let noBox = 0
  let bothBoxes = 0
  for (const page of doc.getPages()) {
    const t = page.node.has(N('TrimBox'))
    const a = page.node.has(N('ArtBox'))
    if (!t && !a) noBox++
    if (t && a) bothBoxes++
  }
  add('Every page has a TrimBox or ArtBox', noBox === 0, noBox ? `${noBox} pages have neither` : undefined)
  add('No page has both a TrimBox and an ArtBox', bothBoxes === 0, bothBoxes ? `${bothBoxes} pages have both` : undefined)
  add('No JavaScript or embedded files', !doc.catalog.lookupMaybe(N('Names'), PDFDict)?.has(N('JavaScript')) && !doc.catalog.lookupMaybe(N('Names'), PDFDict)?.has(N('EmbeddedFiles')) && !doc.catalog.has(N('OpenAction')))
  const tr = findTransparency(doc)
  if (variant === 'x1a') {
    const rgb = rgbUsage(doc)
    add('Only CMYK, grey and spot colours', rgb === 0, rgb ? `${rgb} RGB uses found` : undefined)
    add('No transparency', !(tr.states || tr.softMasks || tr.groups), tr.states || tr.softMasks || tr.groups ? `${tr.states} settings, ${tr.softMasks} soft masks, ${tr.groups} groups` : undefined)
  } else {
    add('Transparency (allowed in X-4)', true, tr.states || tr.softMasks || tr.groups ? 'present' : 'none')
  }
  out.push({ label: 'Not checked here: pictures’ colour spaces and resolution, overprint, trapping details, ink limits, glyph coverage, metadata schemas', status: 'warn' })
  return out
}

/** Sets Info and XMP identification and the output intent, TrimBox and file id. Shared by both variants. */
export async function convertToPdfX(bytes: Uint8Array, fontFor: FontFinder, variant: PdfXVariant, opts: PdfXOptions = DEFAULT_CONDITION, now = new Date()): Promise<{ bytes: Uint8Array; report: PdfAReport }> {
  const label = PDFX_LABEL[variant]
  const report: PdfAReport = { fixed: [], remaining: [], target: label }
  const cleaned = await sanitise(bytes, { metadata: false, attachments: true, javascript: true, comments: false, bookmarks: false, thumbnails: false })
  if (cleaned.removed.javascript) report.fixed.push(`Removed ${cleaned.removed.javascript} script${cleaned.removed.javascript === 1 ? '' : 's'} and action${cleaned.removed.javascript === 1 ? '' : 's'}`)
  if (cleaned.removed.attachments) report.fixed.push(`Removed ${cleaned.removed.attachments} attached file${cleaned.removed.attachments === 1 ? '' : 's'}`)
  let work = cleaned.bytes
  if (variant === 'x1a') {
    const c = await convertColours(work, 'cmyk')
    work = c.bytes
    if (c.report.operators || c.report.pictures) report.fixed.push(`Converted ${c.report.operators} colour setting${c.report.operators === 1 ? '' : 's'} and ${c.report.pictures} picture${c.report.pictures === 1 ? '' : 's'} to CMYK (approximate, no colour profile)`)
    if (c.report.picturesLeft) report.remaining.push(`${c.report.picturesLeft} picture${c.report.picturesLeft === 1 ? '' : 's'} could not be converted to CMYK`)
    if (c.report.spot || c.report.shadings || c.report.inlinePictures) report.remaining.push('Spot colours, shadings or inline pictures were left as they are and may not be CMYK')
  }
  const doc = await PDFDocument.load(work, { updateMetadata: false })
  const ctx = doc.context
  await repairFontsAndResources(doc, fontFor, report)

  const info = infoDictOf(doc)
  if (!text(info.lookup(N('Title'))).trim()) {
    info.set(N('Title'), PDFHexString.fromText('Untitled'))
    report.remaining.push('The document had no title; "Untitled" was written. Set a real title in Properties and convert again')
  }
  const trapped = info.lookup(N('Trapped'))
  if (trapped !== N('True') && trapped !== N('False')) {
    info.set(N('Trapped'), N('False'))
    report.fixed.push('Stated that the file is not trapped (Trapped False); change it in Properties if it has been trapped')
  }
  info.set(N('GTS_PDFXVersion'), PDFString.of(label))
  if (variant === 'x1a') info.set(N('GTS_PDFXConformance'), PDFString.of(label))
  else info.delete(N('GTS_PDFXConformance'))
  const props = propsFromInfo(info, now)
  const trappedNow = info.lookup(N('Trapped')) === N('True') ? 'True' : 'False'
  const xmp = ctx.stream(new TextEncoder().encode(buildXmp(props, undefined, { version: label, trapped: trappedNow })), { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(N('Metadata'), ctx.register(xmp))
  report.fixed.push(`Marked the file as ${label} in its Info entries and metadata`)

  // Output intent.
  const entries: Record<string, unknown> = { Type: 'OutputIntent', S: 'GTS_PDFX' }
  if (variant === 'x4') {
    entries.OutputConditionIdentifier = PDFString.of('sRGB IEC61966-2.1')
    entries.Info = PDFString.of('sRGB IEC61966-2.1')
    entries.DestOutputProfile = ctx.register(ctx.flateStream(srgbIccProfile(now), { N: 3, Alternate: 'DeviceRGB' }))
    report.fixed.push('Added an sRGB output intent (replace it with your printer’s profile for a real print job)')
  } else {
    entries.OutputConditionIdentifier = PDFString.of(opts.condition)
    entries.RegistryName = PDFString.of(opts.registry)
    entries.Info = PDFString.of(opts.condition)
    report.fixed.push(`Named the print condition ${opts.condition} (${opts.registry}); no profile is embedded`)
  }
  doc.catalog.set(N('OutputIntents'), ctx.obj([ctx.register(ctx.obj(entries as never))]))

  // Trim boxes: one of TrimBox or ArtBox on every page, not both.
  let boxed = 0
  for (const page of doc.getPages()) {
    const t = page.node.has(N('TrimBox'))
    const a = page.node.has(N('ArtBox'))
    if (t && a) {
      page.node.delete(N('ArtBox'))
      boxed++
    } else if (!t && !a) {
      const cb = page.getCropBox()
      page.node.set(N('TrimBox'), ctx.obj([cb.x, cb.y, cb.x + cb.width, cb.y + cb.height]))
      boxed++
    }
  }
  if (boxed) report.fixed.push(`Set the TrimBox of ${boxed} page${boxed === 1 ? '' : 's'} (to the crop box)`)

  ensureFileId(doc, report)
  fixAnnotations(doc, report)
  doc.catalog.delete(N('OpenAction'))

  if (variant === 'x1a') {
    const masks = await flattenSoftMasks(doc)
    if (masks.flattened) report.fixed.push(`Flattened ${masks.flattened} picture${masks.flattened === 1 ? '' : 's'} with transparency onto white`)
    const flat = flattenGraphicsStateTransparency(doc)
    if (flat.states || flat.groups) report.fixed.push(`Set ${flat.states} opacity, blend or mask setting${flat.states === 1 ? '' : 's'} to plain values and removed ${flat.groups} transparency group${flat.groups === 1 ? '' : 's'} (the look may change where they were used)`)
    const tr = findTransparency(doc)
    if (tr.softMasks) report.remaining.push(`${tr.softMasks} picture${tr.softMasks === 1 ? ' has a soft mask' : 's have soft masks'} (transparency); rasterise those pages first`)
  }
  report.remaining.push('Not checked: picture colour spaces and resolution, overprint, trapping, ink limits. Preflight with a PDF/X tool before sending to print.')
  const saved = await doc.save({ useObjectStreams: variant === 'x4' })
  return { bytes: setHeaderVersion(saved, variant === 'x4' ? 6 : 4), report }
}
