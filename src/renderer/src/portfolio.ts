/**
 * Embedded files and portfolios. A file embedded in the document (ISO 32000 7.11.4) lives in the catalogue's
 * /Names /EmbeddedFiles name tree; a portfolio ("PDF package") is a PDF whose /Collection entry asks viewers to show
 * those files as the main content, with a cover page for viewers that do not.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, rgb, type PDFObject } from 'pdf-lib'
import { pruneUnreachable } from './redact'

const N = PDFName.of

export interface EmbedFile {
  name: string
  data: Uint8Array
  description?: string
  modified?: Date
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  htm: 'text/html',
  html: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4'
}

/** The media type for a file name, from its extension. */
export const mimeFor = (name: string): string => MIME[/\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase() ?? ''] ?? 'application/octet-stream'

const pdfDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

const nameOf = (o: PDFObject | undefined): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** Every (name, value) pair of the embedded-files name tree, in order. */
function pairs(node: PDFDict | undefined, out: [string, PDFObject][] = []): [string, PDFObject][] {
  if (!node) return out
  const names = node.lookupMaybe(N('Names'), PDFArray)
  if (names) for (let i = 0; i + 1 < names.size(); i += 2) out.push([nameOf(names.lookup(i)), names.get(i + 1)])
  const kids = node.lookupMaybe(N('Kids'), PDFArray)
  if (kids) for (let i = 0; i < kids.size(); i++) pairs(kids.lookupMaybe(i, PDFDict), out)
  return out
}

/** Writes the pairs back as one flat, sorted tree (name trees must be in order). */
function writeTree(doc: PDFDocument, list: [string, PDFObject][]): void {
  const ctx = doc.context
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict) ?? (() => {
    const d = ctx.obj({})
    doc.catalog.set(N('Names'), d)
    return d
  })()
  if (!list.length) {
    names.delete(N('EmbeddedFiles'))
    return
  }
  const sorted = [...list].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const arr = ctx.obj([])
  for (const [k, v] of sorted) {
    arr.push(PDFHexString.fromText(k))
    arr.push(v)
  }
  names.set(N('EmbeddedFiles'), ctx.obj({ Names: arr }))
}

/** A name not already used: report.pdf, then report (2).pdf. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Embeds files in the document (not on a page). A name that is already used gets a number. */
export async function embedFiles(bytes: Uint8Array, files: EmbedFile[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  addFiles(doc, files)
  return doc.save()
}

function addFiles(doc: PDFDocument, files: EmbedFile[]): void {
  const ctx = doc.context
  const list = pairs(doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict))
  const taken = new Set(list.map(([k]) => k))
  for (const f of files) {
    const name = uniqueName(f.name, taken)
    taken.add(name)
    const stream = ctx.register(
      ctx.flateStream(f.data, {
        Type: 'EmbeddedFile',
        Subtype: mimeFor(name),
        Params: { Size: f.data.length, ...(f.modified ? { ModDate: PDFString.of(pdfDate(f.modified)) } : {}) }
      })
    )
    const spec = ctx.obj({
      Type: 'Filespec',
      F: PDFString.of(name.replace(/[^\x20-\x7e]/g, '_')),
      UF: PDFHexString.fromText(name),
      EF: { F: stream }
    })
    if (f.description) spec.set(N('Desc'), PDFHexString.fromText(f.description))
    list.push([name, ctx.register(spec)])
  }
  writeTree(doc, list)
}

/** Takes the document-level embedded file at `index` (in name order, as the attachments list shows) out of the document. */
export async function removeEmbedded(bytes: Uint8Array, index: number, name?: string): Promise<{ bytes: Uint8Array; removed: boolean }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const list = pairs(doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict))
  const target = list[index]
  if (!target || (name !== undefined && target[0] !== name && !specNames(doc, target[1]).includes(name))) return { bytes, removed: false }
  list.splice(index, 1)
  writeTree(doc, list)
  // The file's data is no longer referred to: drop it, or it would still be written out.
  pruneUnreachable(doc)
  return { bytes: await doc.save(), removed: true }
}

function specNames(doc: PDFDocument, ref: PDFObject): string[] {
  const spec = ref instanceof PDFRef ? doc.context.lookup(ref) : ref
  return spec instanceof PDFDict ? [nameOf(spec.lookup(N('UF'))), nameOf(spec.lookup(N('F')))].filter(Boolean) : []
}

export interface PortfolioOptions {
  title: string
  /** Text on the cover page, for viewers that do not show portfolios. */
  cover: string
}

/**
 * A new PDF package: a cover page and the files embedded, with a /Collection entry (details view; name, size, date and
 * description columns) so viewers that support portfolios show the files first.
 */
export async function createPortfolio(files: EmbedFile[], o: PortfolioOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(o.title)
  doc.setCreator('OpenPDF')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([595.28, 841.89])
  page.drawText(o.title, { x: 56, y: 770, size: 22, font: bold, color: rgb(0.1, 0.15, 0.3) })
  let y = 735
  for (const line of (o.cover || 'This PDF is a portfolio. Its files are attached: open it in a PDF reader that supports portfolios, or use the attachments pane.').split(/\r?\n/)) {
    page.drawText(line.replace(/[^\x20-\x7e\xa0-\xff]/g, '?'), { x: 56, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) })
    y -= 16
  }
  y -= 12
  page.drawText('Files in this portfolio', { x: 56, y, size: 13, font: bold })
  y -= 20
  for (const f of files.slice(0, 40)) {
    page.drawText(`${f.name.replace(/[^\x20-\x7e\xa0-\xff]/g, '?')}  (${f.data.length < 1024 ? `${f.data.length} B` : f.data.length < 1048576 ? `${Math.round(f.data.length / 1024)} KB` : `${(f.data.length / 1048576).toFixed(1)} MB`})`, { x: 64, y, size: 10, font })
    y -= 14
    if (y < 60) break
  }
  addFiles(doc, files)
  const ctx = doc.context
  doc.catalog.set(
    N('Collection'),
    ctx.obj({
      Type: 'Collection',
      View: 'D',
      Schema: {
        Type: 'CollectionSchema',
        Name: { Type: 'CollectionField', Subtype: 'S', N: PDFString.of('Name'), O: 1 },
        Size: { Type: 'CollectionField', Subtype: 'N', N: PDFString.of('Size'), O: 2 },
        ModDate: { Type: 'CollectionField', Subtype: 'D', N: PDFString.of('Modified'), O: 3 },
        Desc: { Type: 'CollectionField', Subtype: 'S', N: PDFString.of('Description'), O: 4 }
      },
      Sort: { Type: 'CollectionSort', S: 'Name', A: true }
    })
  )
  return doc.save()
}

/** Whether the document asks viewers to show it as a portfolio. */
export async function isPortfolio(bytes: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  return doc.catalog.has(N('Collection'))
}

export type { PDFNumber }
