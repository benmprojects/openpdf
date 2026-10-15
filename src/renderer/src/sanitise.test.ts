import { PDFArray, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { sanitise, scanHidden } from './sanitise'

const ALL = { metadata: true, attachments: true, javascript: true, comments: true, bookmarks: true, thumbnails: true }

async function withAttachment(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  const ctx = doc.context
  const popup = ctx.nextRef()
  const attach = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'FileAttachment',
      Rect: [10, 10, 30, 30],
      Popup: popup,
      FS: { Type: 'Filespec', F: PDFString.of('secret.txt'), EF: { F: ctx.register(ctx.flateStream(new TextEncoder().encode('SECRET PAYLOAD'))) } }
    })
  )
  ctx.assign(popup, ctx.obj({ Type: 'Annot', Subtype: 'Popup', Parent: attach, Rect: [40, 40, 140, 140] }))
  page.node.set(PDFName.of('Annots'), ctx.obj([attach, popup]))
  return doc.save()
}

describe('sanitise', () => {
  it('finds an attached file on an annotation', async () => {
    expect((await scanHidden(await withAttachment())).attachments).toBe(1)
  })

  it('removes the attachment and its popup, so the file data is not left behind', async () => {
    const out = await sanitise(await withAttachment(), ALL)
    expect((await scanHidden(out.bytes)).attachments).toBe(0)
    expect(Buffer.from(out.bytes).includes(Buffer.from('SECRET PAYLOAD'))).toBe(false)
    const page = (await PDFDocument.load(out.bytes)).getPage(0)
    expect(page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0)
  })
})
