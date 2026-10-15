/**
 * PDF/A and PDF/UA: what a file claims, and basic structural checks against the requirements that are easy to test
 * from the file alone (embedded fonts, metadata, tagging, language, alternative text, and so on). This is a quick
 * look, not a full validator: a pass here does not make a file conformant, and a file with no claim is still checked
 * so the person can see how far from ready it is.
 */
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream, type PDFObject } from 'pdf-lib'
import { bytesToString } from './content'
import { scanHidden } from './sanitise'

const N = PDFName.of

export type CheckStatus = 'pass' | 'fail' | 'warn'
export interface Check {
  standard: 'PDF/A' | 'PDF/UA'
  label: string
  status: CheckStatus
  detail?: string
}

export interface StandardsReport {
  /** What the XMP metadata declares. */
  claims: { pdfa?: { part: number; conformance?: string }; pdfua?: { part: number } }
  checks: Check[]
}

const text = (o: PDFObject | undefined): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** The XMP packet as text, decoded, or ''. */
function xmpOf(doc: PDFDocument): string {
  const m = doc.catalog.lookup(N('Metadata'))
  if (!(m instanceof PDFRawStream)) return ''
  try {
    return bytesToString(decodePDFRawStream(m).decode())
  } catch {
    return ''
  }
}

/** An XMP property written as an element or as an attribute. */
function xmpValue(xmp: string, prefix: string, name: string): string | undefined {
  const el = new RegExp(`<${prefix}:${name}>\\s*([^<]*?)\\s*</${prefix}:${name}>`).exec(xmp)
  if (el) return el[1]
  const at = new RegExp(`${prefix}:${name}\\s*=\\s*"([^"]*)"`).exec(xmp)
  return at?.[1]
}

/** Every font dictionary a page (or a form it draws) uses, found through its resources. */
export function fontsOf(doc: PDFDocument): PDFDict[] {
  const out = new Set<PDFDict>()
  const seen = new Set<PDFDict>()
  const visit = (res: PDFDict | undefined, depth: number) => {
    if (!res || seen.has(res) || depth > 6) return
    seen.add(res)
    const fonts = res.lookupMaybe(N('Font'), PDFDict)
    if (fonts) for (const k of fonts.keys()) {
      const f = fonts.lookupMaybe(k, PDFDict)
      if (f) out.add(f)
    }
    const xo = res.lookupMaybe(N('XObject'), PDFDict)
    if (xo) for (const k of xo.keys()) {
      const x = xo.lookup(k)
      if (x instanceof PDFRawStream && x.dict.lookup(N('Subtype')) === N('Form')) visit(x.dict.lookupMaybe(N('Resources'), PDFDict), depth + 1)
    }
  }
  for (const page of doc.getPages()) {
    let node: PDFDict | undefined = page.node
    for (let i = 0; node && i < 32; i++) {
      const res = node.lookupMaybe(N('Resources'), PDFDict)
      if (res) {
        visit(res, 0)
        break
      }
      node = node.lookupMaybe(N('Parent'), PDFDict)
    }
  }
  return [...out]
}

export function fontIsEmbedded(font: PDFDict): boolean {
  const sub = font.lookup(N('Subtype'))
  if (sub === N('Type3')) return true
  const target = sub === N('Type0') ? font.lookupMaybe(N('DescendantFonts'), PDFArray)?.lookupMaybe(0, PDFDict) : font
  const desc = target?.lookupMaybe(N('FontDescriptor'), PDFDict)
  return !!desc && (desc.has(N('FontFile')) || desc.has(N('FontFile2')) || desc.has(N('FontFile3')))
}

export const fontName = (f: PDFDict) => (f.lookup(N('BaseFont')) as PDFName | undefined)?.decodeText().replace(/^[A-Z]{6}\+/, '') ?? 'unnamed'

/** Whether any page uses transparency (a transparency group, soft mask, blend mode or opacity below one). */
function usesTransparency(doc: PDFDocument): boolean {
  for (const page of doc.getPages()) {
    const group = page.node.lookupMaybe(N('Group'), PDFDict)
    if (group?.lookup(N('S')) === N('Transparency')) return true
    const gs = page.node.lookupMaybe(N('Resources'), PDFDict)?.lookupMaybe(N('ExtGState'), PDFDict)
    if (!gs) continue
    for (const k of gs.keys()) {
      const g = gs.lookupMaybe(k, PDFDict)
      if (!g) continue
      const num = (key: string) => g.lookupMaybe(N(key), PDFNumber)?.asNumber()
      const sm = g.lookup(N('SMask'))
      const bm = g.lookup(N('BM'))
      if ((num('ca') ?? 1) < 1 || (num('CA') ?? 1) < 1 || (sm !== undefined && sm !== N('None')) || (bm !== undefined && bm !== N('Normal') && bm !== N('Compatible'))) return true
    }
  }
  return false
}

/** Figure elements of the structure tree, and how many have alternative text. */
function figures(doc: PDFDocument): { total: number; withAlt: number; nodes: number } {
  let total = 0
  let withAlt = 0
  let nodes = 0
  const root = doc.catalog.lookupMaybe(N('StructTreeRoot'), PDFDict)
  const seen = new Set<PDFDict>()
  const walk = (o: PDFObject | undefined) => {
    if (nodes > 50000 || !o) return
    if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) walk(o.lookup(i))
      return
    }
    if (!(o instanceof PDFDict) || seen.has(o)) return
    seen.add(o)
    nodes++
    if (o.lookup(N('S')) === N('Figure')) {
      total++
      if (text(o.lookup(N('Alt'))) || text(o.lookup(N('ActualText')))) withAlt++
    }
    walk(o.lookup(N('K')))
  }
  if (root) walk(root.lookup(N('K')))
  return { total, withAlt, nodes }
}

/** Form fields (leaf fields with a type) and how many have a tooltip (/TU), which screen readers use as the name. */
function fieldNames(doc: PDFDocument): { total: number; named: number } {
  let total = 0
  let named = 0
  const seen = new Set<PDFDict>()
  const walk = (arr: PDFArray | undefined, inheritedTu: boolean) => {
    if (!arr) return
    for (let i = 0; i < arr.size(); i++) {
      const f = arr.lookupMaybe(i, PDFDict)
      if (!f || seen.has(f)) continue
      seen.add(f)
      const tu = inheritedTu || !!text(f.lookup(N('TU')))
      const kids = f.lookupMaybe(N('Kids'), PDFArray)
      const hasChildFields = !!kids && Array.from({ length: kids.size() }, (_, k) => kids.lookupMaybe(k, PDFDict)).some((d) => d?.has(N('T')))
      if (hasChildFields) walk(kids, tu)
      else if (f.has(N('FT')) || f.has(N('Parent'))) {
        total++
        if (tu) named++
      }
    }
  }
  walk(doc.catalog.lookupMaybe(N('AcroForm'), PDFDict)?.lookupMaybe(N('Fields'), PDFArray), false)
  return { total, named }
}

export async function checkStandards(bytes: Uint8Array): Promise<StandardsReport> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const cat = doc.catalog
  const xmp = xmpOf(doc)
  const checks: Check[] = []
  const add = (standard: Check['standard'], label: string, status: CheckStatus, detail?: string) => checks.push({ standard, label, status, detail })

  const part = xmpValue(xmp, 'pdfaid', 'part')
  const conf = xmpValue(xmp, 'pdfaid', 'conformance')
  const uaPart = xmpValue(xmp, 'pdfuaid', 'part')
  const claims: StandardsReport['claims'] = {}
  if (part && /^\d$/.test(part)) claims.pdfa = { part: Number(part), conformance: conf?.toUpperCase() }
  if (uaPart && /^\d$/.test(uaPart)) claims.pdfua = { part: Number(uaPart) }

  // ---- PDF/A ----
  add('PDF/A', 'Declares its conformance in the XMP metadata', claims.pdfa ? 'pass' : 'fail', claims.pdfa ? `PDF/A-${claims.pdfa.part}${claims.pdfa.conformance ? claims.pdfa.conformance.toLowerCase() : ''}` : xmp ? 'The XMP metadata has no PDF/A identification.' : 'The file has no XMP metadata.')
  add('PDF/A', 'Has XMP metadata', xmp ? 'pass' : 'fail')
  add('PDF/A', 'Is not encrypted', doc.context.trailerInfo.Encrypt ? 'fail' : 'pass')
  const fonts = fontsOf(doc)
  const loose = [...new Set(fonts.filter((f) => !fontIsEmbedded(f)).map(fontName))]
  add('PDF/A', 'Embeds every font', loose.length ? 'fail' : 'pass', loose.length ? `Not embedded: ${loose.slice(0, 6).join(', ')}${loose.length > 6 ? ` and ${loose.length - 6} more` : ''}` : fonts.length ? `${fonts.length} font${fonts.length === 1 ? '' : 's'}` : undefined)
  const intents = cat.lookupMaybe(N('OutputIntents'), PDFArray)
  const hasIntent = !!intents && Array.from({ length: intents.size() }, (_, i) => intents.lookupMaybe(i, PDFDict)).some((d) => d?.lookup(N('S')) === N('GTS_PDFA1'))
  add('PDF/A', 'Has a PDF/A output intent (colour profile)', hasIntent ? 'pass' : 'fail')
  const hidden = await scanHidden(bytes)
  add('PDF/A', 'Has no JavaScript', hidden.javascript ? 'fail' : 'pass', hidden.javascript ? `${hidden.javascript} script${hidden.javascript === 1 ? '' : 's'} or action${hidden.javascript === 1 ? '' : 's'}` : undefined)
  const attachmentsOk = claims.pdfa?.part === 3
  add('PDF/A', attachmentsOk ? 'Embedded files (allowed in PDF/A-3)' : 'Has no embedded files', hidden.attachments && !attachmentsOk ? 'fail' : 'pass', hidden.attachments ? `${hidden.attachments} file${hidden.attachments === 1 ? '' : 's'}` : undefined)
  if (!claims.pdfa || claims.pdfa.part === 1) add('PDF/A', 'Uses no transparency (PDF/A-1)', usesTransparency(doc) ? 'fail' : 'pass')

  // ---- PDF/UA ----
  add('PDF/UA', 'Declares PDF/UA in the XMP metadata', claims.pdfua ? 'pass' : 'fail', claims.pdfua ? `PDF/UA-${claims.pdfua.part}` : undefined)
  const marked = cat.lookupMaybe(N('MarkInfo'), PDFDict)?.lookup(N('Marked'))
  add('PDF/UA', 'Is marked as a tagged PDF', marked instanceof PDFBool && marked.asBoolean() ? 'pass' : 'fail')
  const hasTree = cat.has(N('StructTreeRoot'))
  add('PDF/UA', 'Has a structure tree (tags)', hasTree ? 'pass' : 'fail')
  add('PDF/UA', 'Sets the document language', text(cat.lookup(N('Lang'))) ? 'pass' : 'fail', text(cat.lookup(N('Lang'))) || undefined)
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  const title = xmpValue(xmp, 'dc', 'title') || /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)</.exec(xmp)?.[1] || text(info?.lookup(N('Title')))
  const display = cat.lookupMaybe(N('ViewerPreferences'), PDFDict)?.lookup(N('DisplayDocTitle'))
  add('PDF/UA', 'Has a title, shown in the window title bar', title && display instanceof PDFBool && display.asBoolean() ? 'pass' : 'fail', !title ? 'No title.' : display instanceof PDFBool && display.asBoolean() ? title : 'The title is not set to show in the title bar.')
  if (hasTree) {
    const fig = figures(doc)
    add('PDF/UA', 'Figures have alternative text', fig.total === 0 ? 'pass' : fig.withAlt === fig.total ? 'pass' : 'fail', fig.total ? `${fig.withAlt} of ${fig.total} figure${fig.total === 1 ? '' : 's'}` : 'No figures')
  }
  const fields = fieldNames(doc)
  if (fields.total) add('PDF/UA', 'Form fields have names for screen readers (tooltips)', fields.named === fields.total ? 'pass' : 'fail', `${fields.named} of ${fields.total}`)
  const pages = doc.getPages()
  const needTabs = pages.filter((p) => (p.node.lookupMaybe(N('Annots'), PDFArray)?.size() ?? 0) > 0 && !p.node.has(N('Tabs')))
  add('PDF/UA', 'Sets the tab order on pages with links or fields', needTabs.length ? 'fail' : 'pass', needTabs.length ? `${needTabs.length} page${needTabs.length === 1 ? '' : 's'} without it` : undefined)
  if (pages.length > 20) add('PDF/UA', 'Has bookmarks (long document)', cat.has(N('Outlines')) ? 'pass' : 'warn')
  return { claims, checks }
}
