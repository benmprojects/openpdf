/**
 * Media in a PDF: audio and video that Screen annotations (through a rendition), Movie annotations and RichMedia
 * annotations carry as embedded files. They are found by reading the document's structure, and the bytes are played
 * in a player of the browser's own. 3D annotations are reported, not shown: there is no U3D or PRC renderer here.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream, type PDFObject } from 'pdf-lib'

const N = PDFName.of

export interface MediaItem {
  id: string
  kind: 'audio' | 'video' | '3d'
  /** Zero-based page. */
  page: number
  name: string
  mime: string
  /** Size in bytes, or -1 when there is no file (3D). */
  size: number
  /** Whether the browser's player can play this type. */
  playable: boolean
  /** The file's bytes (not for 3D). */
  read(): Uint8Array
}

const TYPES: Record<string, [string, 'audio' | 'video']> = {
  mp4: ['video/mp4', 'video'],
  m4v: ['video/mp4', 'video'],
  webm: ['video/webm', 'video'],
  ogv: ['video/ogg', 'video'],
  mov: ['video/quicktime', 'video'],
  avi: ['video/x-msvideo', 'video'],
  wmv: ['video/x-ms-wmv', 'video'],
  mpg: ['video/mpeg', 'video'],
  mpeg: ['video/mpeg', 'video'],
  mp3: ['audio/mpeg', 'audio'],
  wav: ['audio/wav', 'audio'],
  ogg: ['audio/ogg', 'audio'],
  oga: ['audio/ogg', 'audio'],
  m4a: ['audio/mp4', 'audio'],
  aac: ['audio/aac', 'audio'],
  flac: ['audio/flac', 'audio'],
  wma: ['audio/x-ms-wma', 'audio']
}

/** Types Chromium plays without extra codecs. */
const PLAYABLE = new Set(['video/mp4', 'video/webm', 'video/ogg', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac'])

const text = (o: PDFObject | undefined): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** The type from a MIME string or a file name; null when it is not audio or video. */
export function mediaType(mime: string, name: string): { mime: string; kind: 'audio' | 'video' } | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase() ?? ''
  const byExt = TYPES[ext]
  if (/^(audio|video)\//i.test(mime)) {
    const m = mime.toLowerCase()
    return { mime: m, kind: m.startsWith('audio') ? 'audio' : 'video' }
  }
  return byExt ? { mime: byExt[0], kind: byExt[1] } : null
}

/** The embedded file of a file specification (or a bare stream), with its name. */
function fileOf(spec: PDFObject | undefined): { name: string; stream: PDFRawStream } | null {
  if (spec instanceof PDFRawStream) return { name: '', stream: spec }
  if (!(spec instanceof PDFDict)) return null
  const ef = spec.lookupMaybe(N('EF'), PDFDict)
  const stream = ef?.lookup(N('F')) ?? ef?.lookup(N('UF'))
  if (!(stream instanceof PDFRawStream)) return null
  return { name: text(spec.lookup(N('UF'))) || text(spec.lookup(N('F'))), stream }
}

const bytesOf = (s: PDFRawStream): Uint8Array => decodePDFRawStream(s).decode()

/** Every asset of a RichMedia annotation (its /RichMediaContent /Assets name tree). */
function richMediaAssets(annot: PDFDict): { name: string; stream: PDFRawStream }[] {
  const out: { name: string; stream: PDFRawStream }[] = []
  const visit = (node: PDFDict | undefined, depth: number) => {
    if (!node || depth > 8) return
    const names = node.lookupMaybe(N('Names'), PDFArray)
    if (names) for (let i = 0; i + 1 < names.size(); i += 2) {
      const f = fileOf(names.lookup(i + 1))
      if (f) out.push({ name: f.name || text(names.lookup(i)), stream: f.stream })
    }
    const kids = node.lookupMaybe(N('Kids'), PDFArray)
    if (kids) for (let i = 0; i < kids.size(); i++) visit(kids.lookupMaybe(i, PDFDict), depth + 1)
  }
  visit(annot.lookupMaybe(N('RichMediaContent'), PDFDict)?.lookupMaybe(N('Assets'), PDFDict), 0)
  return out
}

/** Finds playable media (and 3D content) on the pages of a document. */
export async function findMedia(bytes: Uint8Array): Promise<MediaItem[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const items: MediaItem[] = []
  const add = (page: number, name: string, mime: string, stream: PDFRawStream) => {
    const t = mediaType(mime, name)
    if (!t) return
    const data = (() => {
      let cache: Uint8Array | null = null
      return () => (cache ??= bytesOf(stream))
    })()
    items.push({ id: `${page}-${items.length}`, kind: t.kind, page, name: name || `${t.kind} file`, mime: t.mime, size: stream.contents.length, playable: PLAYABLE.has(t.mime), read: data })
  }
  doc.getPages().forEach((p, page) => {
    const annots = p.node.lookupMaybe(N('Annots'), PDFArray)
    if (!annots) return
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict)
      if (!a) continue
      const sub = (a.lookup(N('Subtype')) as PDFName | undefined)?.decodeText()
      const title = text(a.lookup(N('T')))
      if (sub === 'Screen') {
        // The action's rendition names a media clip whose data is a file specification or a stream.
        const rendition = a.lookupMaybe(N('A'), PDFDict)?.lookupMaybe(N('R'), PDFDict)
        const clip = rendition?.lookupMaybe(N('C'), PDFDict)
        const f = fileOf(clip?.lookup(N('D')))
        if (f) add(page, f.name || text(clip?.lookup(N('N'))) || title, text(clip?.lookup(N('CT'))), f.stream)
      } else if (sub === 'Movie') {
        const f = fileOf(a.lookupMaybe(N('Movie'), PDFDict)?.lookup(N('F')))
        if (f) add(page, f.name || title, '', f.stream)
      } else if (sub === 'RichMedia') {
        for (const asset of richMediaAssets(a)) add(page, asset.name, '', asset.stream)
      } else if (sub === '3D') {
        items.push({ id: `${page}-${items.length}`, kind: '3d', page, name: title || '3D model', mime: 'model/u3d', size: -1, playable: false, read: () => new Uint8Array(0) })
      }
    }
  })
  return items
}
