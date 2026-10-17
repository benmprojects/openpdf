import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { readSignatures } from './sign'
import { clearSignatures, visibleSignatureCount } from './signClear'

/** A one-page file with two signature fields: one signed (visible, certifying) and one empty. The signature data is not real. */
async function signedFile(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  const ctx = doc.context
  const ap = ctx.register(ctx.stream('0 0 1 rg 0 0 100 40 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 40] } as never))
  const sig = ctx.register(
    ctx.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'adbe.pkcs7.detached',
      ByteRange: [0, 10, 20, 30],
      Contents: PDFHexString.of('3000'),
      Name: PDFHexString.fromText('Tester')
    })
  )
  const signed = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Signature1'), V: sig, Rect: [20, 200, 120, 240], F: 132, P: page.ref, AP: { N: ap } }))
  const empty = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Signature2'), Rect: [20, 100, 120, 140], F: 4, P: page.ref }))
  page.node.set(PDFName.of('Annots'), ctx.obj([signed, empty]))
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [signed, empty], SigFlags: 3 }))
  doc.catalog.set(PDFName.of('Perms'), ctx.obj({ DocMDP: sig }))
  return doc.save({ useObjectStreams: false })
}

describe('clearing signatures', () => {
  it('empties the signed field, keeps the field, and removes the certification', async () => {
    const start = await signedFile()
    expect(await readSignatures(start)).toHaveLength(1)
    const { bytes, cleared } = await clearSignatures(start, false)
    expect(cleared).toBe(1)
    expect(await readSignatures(bytes)).toHaveLength(0)
    const doc = await PDFDocument.load(bytes)
    const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)!
    expect(form.lookupMaybe(PDFName.of('Fields'), PDFArray)!.size()).toBe(2)
    expect(form.has(PDFName.of('SigFlags'))).toBe(false)
    expect(doc.catalog.has(PDFName.of('Perms'))).toBe(false)
    const widget = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)!.lookupMaybe(0, PDFDict)!
    expect(widget.has(PDFName.of('V'))).toBe(false)
    expect(widget.has(PDFName.of('AP'))).toBe(false)
  })

  it('can keep the look as page content, and then the field is gone', async () => {
    const start = await signedFile()
    expect(await visibleSignatureCount(start)).toBe(1)
    const { bytes, cleared } = await clearSignatures(start, true)
    expect(cleared).toBe(1)
    const doc = await PDFDocument.load(bytes)
    const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)!
    expect(form.lookupMaybe(PDFName.of('Fields'), PDFArray)!.size()).toBe(1)
    expect(doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)!.size()).toBe(1)
    const res = doc.getPage(0).node.lookupMaybe(PDFName.of('Resources'), PDFDict)!.lookupMaybe(PDFName.of('XObject'), PDFDict)!
    expect(res.keys().some((k) => k.decodeText().startsWith('FlatSig'))).toBe(true)
    expect(await readSignatures(bytes)).toHaveLength(0)
  })

  it('does nothing to a file with no signatures', async () => {
    const d = await PDFDocument.create()
    d.addPage([100, 100])
    const b = await d.save()
    const r = await clearSignatures(b, false)
    expect(r.cleared).toBe(0)
    expect(r.bytes).toBe(b)
    expect(await visibleSignatureCount(b)).toBe(0)
  })
})

describe('what is left of a cleared signature', () => {
  it('is not still in the file', async () => {
    const start = await signedFile()
    expect(new TextDecoder('latin1').decode(start)).toContain('/ByteRange')
    for (const keep of [false, true]) {
      const { bytes } = await clearSignatures(start, keep)
      const text = new TextDecoder('latin1').decode(bytes)
      expect(text).not.toContain('/ByteRange')
      expect(text).not.toContain('adbe.pkcs7.detached')
    }
  })
})
