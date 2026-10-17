import { PDFiumLibrary } from '@hyzyla/pdfium'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { expandForms, renameResources } from './formExpand'
import { pageContent } from './pageContent'

/** A page that draws Times as /F1 and a form (moved to 20, 30) that draws "inside" in Helvetica Bold, also called /F1. */
async function sample(extra: Record<string, unknown> = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const times = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ctx = doc.context
  const form = ctx.register(ctx.flateStream('BT /F1 14 Tf 0 0 Td (inside) Tj ET 0 0 80 40 re S', { Type: 'XObject', Subtype: 'Form', BBox: [-5, -5, 120, 60], Matrix: [1, 0, 0, 1, 20, 30], Resources: { Font: { F1: bold.ref } }, ...extra }))
  const page = doc.addPage([200, 150])
  page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: times.ref }, XObject: { Fm0: form } }))
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('BT /F1 12 Tf 10 120 Td (outside) Tj ET /Fm0 Do')))
  return doc.save()
}

describe('renameResources', () => {
  it('renames only the named resources of the right kind', () => {
    const out = renameResources('/F1 12 Tf /F1 Do /Im1 Do (F1) Tj', new Map([['Font/F1', 'F1x1']]))
    expect(out).toBe('/F1x1 12 Tf /F1 Do /Im1 Do (F1) Tj')
    expect(renameResources('/P1 scn /GS0 gs', new Map([['Pattern/P1', 'P1x2'], ['ExtGState/GS0', 'GS0x1']]))).toBe('/P1x2 scn /GS0x1 gs')
  })
})

describe('expandForms', () => {
  it('puts the form content on the page, clipped and moved, with its font kept apart from the page font', async () => {
    const r = await expandForms(await sample())
    expect(r.expanded).toBe(1)
    expect(r.pages).toEqual([0])
    const doc = await PDFDocument.load(r.bytes)
    const src = pageContent(doc.getPage(0))
    expect(src).not.toContain('/Fm0 Do')
    expect(src).toContain('1 0 0 1 20 30 cm -5 -5 125 65 re W n')
    expect(src).toContain('/F1x1 14 Tf')
    expect(src).toContain('/F1 12 Tf')
    const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), (await import('pdf-lib')).PDFDict)
    expect(fonts.keys().map(String).sort()).toEqual(['/F1', '/F1x1'])
  })

  it('draws the same page after unpacking: PDFium sees both lines at page level, in the right fonts and places', async () => {
    const before = await sample()
    const after = (await expandForms(before)).bytes
    const lib = await PDFiumLibrary.init()
    const render = async (b: Uint8Array) => {
      const pdf = await lib.loadDocument(b)
      const p = pdf.getPage(0)
      const r = await p.render({ scale: 1, render: 'bitmap' })
      const text = p.getText()
      p.close()
      pdf.destroy()
      return { data: r.data, text }
    }
    const a = await render(before)
    const b = await render(after)
    expect(b.text).toContain('inside')
    expect(b.text).toContain('outside')
    let different = 0
    for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) > 40) different++
    expect(different).toBeLessThan(20)
    lib.destroy()
  })

  it('leaves forms on a layer alone and says so', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: 'x' }))
    const form = ctx.register(ctx.flateStream('0 0 10 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], OC: ocg }))
    const page = doc.addPage([50, 50])
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fm0: form } }))
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('/Fm0 Do')))
    const r = await expandForms(await doc.save())
    expect(r.expanded).toBe(0)
    expect(r.skipped).toEqual([{ reason: 'The form is on a layer', count: 1 }])
  })

  it('unpacks forms inside forms', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const inner = ctx.register(ctx.flateStream('0 0 10 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }))
    const outer = ctx.register(ctx.flateStream('/In Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50], Resources: { XObject: { In: inner } } }))
    const page = doc.addPage([50, 50])
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Out: outer } }))
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('/Out Do')))
    const r = await expandForms(await doc.save())
    expect(r.expanded).toBe(2)
    expect(pageContent((await PDFDocument.load(r.bytes)).getPage(0))).toContain('0 0 10 10 re f')
  })
})
