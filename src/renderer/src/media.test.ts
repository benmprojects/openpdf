import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { findMedia, mediaType } from './media'

const WAV = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
const MP4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])

async function build(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  const ctx = doc.context
  const file = (name: string, data: Uint8Array) => ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of(name), EF: { F: ctx.register(ctx.flateStream(data)) } }))
  const annots = ctx.obj([])
  // A Screen annotation whose rendition's media clip holds a WAV.
  annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Screen', Rect: [10, 10, 110, 60], T: PDFString.of('Intro'), A: { S: 'Rendition', R: { Type: 'Rendition', S: 'MR', C: { Type: 'MediaClip', S: 'MCD', N: PDFString.of('clip'), CT: PDFString.of('audio/wav'), D: file('intro.wav', WAV) } } } })))
  // A Movie annotation.
  annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Movie', Rect: [10, 70, 110, 120], Movie: { F: file('site.mp4', MP4) } })))
  // A RichMedia annotation with an MP4 asset and a script that is not media.
  annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'RichMedia', Rect: [10, 130, 110, 180], RichMediaContent: { Assets: { Names: [PDFString.of('walk.mp4'), file('walk.mp4', MP4), PDFString.of('player.js'), file('player.js', Uint8Array.from([1, 2]))] } } })))
  // A 3D annotation, and a file the browser cannot play.
  annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: '3D', Rect: [10, 190, 110, 240], T: PDFString.of('Pump model') })))
  annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Movie', Rect: [120, 70, 220, 120], Movie: { F: file('old.wmv', MP4) } })))
  page.node.set(PDFName.of('Annots'), annots)
  return doc.save()
}

describe('mediaType', () => {
  it('uses a MIME type when it is audio or video, else the file extension', () => {
    expect(mediaType('audio/mpeg', 'x')).toEqual({ mime: 'audio/mpeg', kind: 'audio' })
    expect(mediaType('', 'clip.MP4')).toEqual({ mime: 'video/mp4', kind: 'video' })
    expect(mediaType('application/pdf', 'doc.pdf')).toBeNull()
    expect(mediaType('', 'noextension')).toBeNull()
  })
})

describe('findMedia', () => {
  it('finds media in Screen, Movie and RichMedia annotations, and reports 3D', async () => {
    const items = await findMedia(await build())
    expect(items.map((i) => [i.kind, i.name, i.mime, i.playable])).toEqual([
      ['audio', 'intro.wav', 'audio/wav', true],
      ['video', 'site.mp4', 'video/mp4', true],
      ['video', 'walk.mp4', 'video/mp4', true],
      ['3d', 'Pump model', 'model/u3d', false],
      ['video', 'old.wmv', 'video/x-ms-wmv', false]
    ])
    expect(Array.from(items[0].read())).toEqual(Array.from(WAV))
    expect(items.every((i) => i.page === 0)).toBe(true)
  })

  it('finds nothing in an ordinary document', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    expect(await findMedia(await doc.save())).toEqual([])
  })
})
