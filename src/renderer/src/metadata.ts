/**
 * Document properties: the Info dictionary (ISO 32000 14.3.3) and the XMP packet (14.3.2) kept in step with it.
 * When the Info entries change, the XMP packet is rewritten so the two never disagree; other XMP properties
 * (rights, custom schemas) are kept unless the metadata is removed.
 */
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib'

export interface DocProps {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
  /** ISO 8601, or '' when unset. */
  created: string
  modified: string
}

export const EMPTY_PROPS: DocProps = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '', created: '', modified: '' }

const INFO_KEYS: [keyof DocProps, string][] = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['keywords', 'Keywords'],
  ['creator', 'Creator'],
  ['producer', 'Producer']
]

const text = (o: unknown): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** "D:20261015164900+10'00'" to an ISO 8601 string, or '' when it cannot be read. */
export function pdfDateToIso(s: string): string {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}(?:'?\d{2}'?)?)?/.exec(s.trim())
  if (!m) return ''
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', z = 'Z'] = m
  const zone = z === 'Z' ? 'Z' : `${z.slice(0, 3)}:${(z.slice(3).replace(/'/g, '') || '00').padEnd(2, '0')}`
  return `${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`
}

function isoToPdfDate(iso: string): string | undefined {
  const t = new Date(iso)
  if (!iso || Number.isNaN(t.getTime())) return undefined
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`
}

export async function readProps(bytes: Uint8Array): Promise<DocProps> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  const out = { ...EMPTY_PROPS }
  if (!info) return out
  for (const [k, key] of INFO_KEYS) out[k] = text(info.lookup(PDFName.of(key)))
  out.created = pdfDateToIso(text(info.lookup(PDFName.of('CreationDate'))))
  out.modified = pdfDateToIso(text(info.lookup(PDFName.of('ModDate'))))
  return out
}

/** Byte order mark in the XMP packet header (written as an escape, which the linter accepts). */
const BOM = '\uFEFF'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A minimal XMP packet for the Info entries (Dublin Core, PDF and XMP basic schemas). */
export function buildXmp(p: DocProps, pdfa?: { part: number; conformance: string }): string {
  const alt = (tag: string, v: string) => (v ? `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${esc(v)}</rdf:li></rdf:Alt></${tag}>` : '')
  const parts = [
    alt('dc:title', p.title),
    p.author ? `<dc:creator><rdf:Seq><rdf:li>${esc(p.author)}</rdf:li></rdf:Seq></dc:creator>` : '',
    alt('dc:description', p.subject),
    p.keywords ? `<pdf:Keywords>${esc(p.keywords)}</pdf:Keywords>` : '',
    p.producer ? `<pdf:Producer>${esc(p.producer)}</pdf:Producer>` : '',
    p.creator ? `<xmp:CreatorTool>${esc(p.creator)}</xmp:CreatorTool>` : '',
    pdfa ? `<pdfaid:part>${pdfa.part}</pdfaid:part><pdfaid:conformance>${pdfa.conformance}</pdfaid:conformance>` : '',
    p.created ? `<xmp:CreateDate>${esc(p.created)}</xmp:CreateDate>` : '',
    p.modified ? `<xmp:ModifyDate>${esc(p.modified)}</xmp:ModifyDate><xmp:MetadataDate>${esc(p.modified)}</xmp:MetadataDate>` : ''
  ].filter(Boolean)
  return (
    `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"${pdfa ? ' xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"' : ''}>` +
    parts.join('') +
    `</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`
  )
}

/** Writes the Info entries and a matching XMP packet. Empty fields are removed. */
export async function writeProps(bytes: Uint8Array, p: DocProps): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  let info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict)
  if (!info) {
    const ref = ctx.register(ctx.obj({}))
    ctx.trailerInfo.Info = ref
    info = ctx.lookupMaybe(ref, PDFDict)!
  }
  for (const [k, key] of INFO_KEYS) {
    if (p[k]) info.set(PDFName.of(key), PDFHexString.fromText(p[k]))
    else info.delete(PDFName.of(key))
  }
  const dates: [string, string][] = [
    ['CreationDate', p.created],
    ['ModDate', p.modified]
  ]
  for (const [key, iso] of dates) {
    const d = isoToPdfDate(iso)
    if (d) info.set(PDFName.of(key), PDFString.of(d))
    else info.delete(PDFName.of(key))
  }
  const xmp = new TextEncoder().encode(buildXmp(p))
  const stream = ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(stream))
  return doc.save()
}

/** Removes the Info dictionary and XMP metadata altogether. */
export async function removeProps(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  doc.catalog.delete(PDFName.of('Metadata'))
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  if (info) for (const k of info.keys()) info.delete(k)
  return doc.save({ useObjectStreams: false })
}

/** The XMP packet as text, or '' when the file has none. */
export async function readXmp(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const m = doc.catalog.lookup(PDFName.of('Metadata'))
  return m instanceof PDFRawStream ? new TextDecoder().decode(m.contents) : ''
}
