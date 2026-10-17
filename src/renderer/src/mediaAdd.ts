/**
 * Adds a video or sound file to a page as a Screen annotation with a rendition (ISO 32000 12.5.6.18 and 13.2): the file
 * is embedded, and clicking the annotation plays it in a viewer that supports media (OpenPDF's own player lists and
 * plays these from the Media pane). The annotation shows a dark box with a play triangle until played. RichMedia
 * (Flash-era, rarely supported) and 3D are not written. Files other than MP4, WebM, Ogg, MP3, WAV, M4A, AAC and FLAC
 * are accepted but only play where the viewer has a codec for them.
 */
import { PDFDocument, PDFHexString, PDFString } from 'pdf-lib'
import { frameFor } from './annotWrite'
import { mediaType } from './media'


export interface MediaFile {
  name: string
  data: Uint8Array
}

/** The default box for a kind of media, in points: video 16:9, sound a slim player bar. */
export function defaultSize(kind: 'audio' | 'video'): { w: number; h: number } {
  return kind === 'video' ? { w: 320, h: 180 } : { w: 220, h: 36 }
}

const MAX_BYTES = 200 * 1024 * 1024

/** Whether a file can be added, and why not. */
export function checkMediaFile(f: MediaFile): { ok: true; mime: string; kind: 'audio' | 'video' } | { ok: false; reason: string } {
  const t = mediaType('', f.name)
  if (!t) return { ok: false, reason: 'That is not a video or sound file this program knows (MP4, WebM, Ogg, MP3, WAV, M4A, AAC, FLAC, MOV, AVI, WMV, MPEG).' }
  if (f.data.length > MAX_BYTES) return { ok: false, reason: 'That file is over 200 MB; it would make the PDF very slow to open.' }
  if (!f.data.length) return { ok: false, reason: 'That file is empty.' }
  return { ok: true, mime: t.mime, kind: t.kind }
}

/** The appearance: a dark rounded-corner box with a white play triangle, drawn in the box's own coordinates. */
function appearance(w: number, h: number): string {
  const s = Math.min(w, h) * 0.5
  const cx = w / 2
  const cy = h / 2
  return `q 0.13 0.13 0.15 rg 0 0 ${w.toFixed(2)} ${h.toFixed(2)} re f 1 g ${(cx - s * 0.3).toFixed(2)} ${(cy - s / 2).toFixed(2)} m ${(cx + s * 0.5).toFixed(2)} ${cy.toFixed(2)} l ${(cx - s * 0.3).toFixed(2)} ${(cy + s / 2).toFixed(2)} l f Q`
}

/**
 * Puts the file on a page, centred on a point given in display space (points from the top-left of the page as shown).
 * `size` is the box in points (default by kind). Returns the new file.
 */
export async function addMedia(bytes: Uint8Array, pageIndex: number, centre: { x: number; y: number }, file: MediaFile, size?: { w: number; h: number }): Promise<Uint8Array> {
  const check = checkMediaFile(file)
  if (!check.ok) throw new Error(check.reason)
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const page = doc.getPage(pageIndex)
  const cb = page.getCropBox()
  const rotation = page.getRotation().angle
  const sideways = rotation % 180 !== 0
  const shownW = sideways ? cb.height : cb.width
  const shownH = sideways ? cb.width : cb.height
  const want = size ?? defaultSize(check.kind)
  const w = Math.min(want.w, shownW)
  const h = Math.min(want.h, shownH)
  const x = Math.max(0, Math.min(shownW - w, centre.x - w / 2))
  const y = Math.max(0, Math.min(shownH - h, centre.y - h / 2))
  // Display rectangle (y down) to a page-space bounding box.
  const f = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, rotation).m
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [f[0] * px + f[2] * py + f[4], f[1] * px + f[3] * py + f[5]])
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  const bw = rect[2] - rect[0]
  const bh = rect[3] - rect[1]

  const stream = ctx.register(ctx.flateStream(file.data, { Type: 'EmbeddedFile', Subtype: check.mime.replace('/', '#2F'), Params: { Size: file.data.length } }))
  const spec = ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of(asciiName(file.name)), UF: PDFHexString.fromText(file.name), EF: { F: stream, UF: stream } }))
  const clip = ctx.obj({ Type: 'MediaClip', S: 'MCD', N: PDFHexString.fromText(file.name), CT: PDFString.of(check.mime), D: spec, P: { Type: 'MediaPermissions', TF: PDFString.of('TEMPALWAYS') } })
  const rendition = ctx.obj({ Type: 'Rendition', S: 'MR', N: PDFHexString.fromText(file.name), C: clip })
  const ap = ctx.register(ctx.flateStream(new TextEncoder().encode(appearance(bw, bh)), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, bw, bh], Resources: {} }))
  const annotRef = ctx.nextRef()
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'Screen',
    Rect: rect,
    F: 4,
    P: page.ref,
    T: PDFHexString.fromText(file.name),
    Contents: PDFHexString.fromText(file.name),
    AP: { N: ap },
    A: { Type: 'Action', S: 'Rendition', OP: 0, AN: annotRef, R: rendition }
  })
  ctx.assign(annotRef, annot)
  page.node.addAnnot(annotRef)
  return doc.save()
}

/** A plain-ASCII file name for the /F entry (the full name is in /UF). */
function asciiName(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, '_') || 'media'
}
