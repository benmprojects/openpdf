/**
 * A small tagged PDF made from scratch, for the unit tests and the end-to-end specs of the tags and accessibility
 * features. Page 1: a heading, a paragraph, a figure with no alternative text and a page number marked as an artefact.
 * Page 2: a heading that skips a level and a paragraph. Everything is built through the pdf-lib object model.
 */
import { PDFArray, PDFDocument, PDFName, PDFRef, PDFString, StandardFonts } from 'pdf-lib'

export interface FixtureOptions {
  /** Leave the figure without alternative text (the default) or give it some. */
  figureAlt?: string
  /** Set the document language and title. */
  lang?: string
  title?: string
  /** Add a link annotation that is not in the structure tree. */
  untaggedLink?: boolean
}

export async function buildTaggedPdf(o: FixtureOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const ctx = doc.context
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([300, 400])
  const p2 = doc.addPage([300, 400])
  const fontName = (page: typeof p1) => {
    page.node.setFontDictionary(PDFName.of('F1'), font.ref)
  }
  fontName(p1)
  fontName(p2)
  const setContent = (page: typeof p1, src: string) => page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(src)))
  setContent(
    p1,
    [
      '/H1 <</MCID 0>> BDC BT /F1 18 Tf 20 360 Td (Report title) Tj ET EMC',
      '/P <</MCID 1>> BDC BT /F1 11 Tf 20 330 Td (This is the first paragraph.) Tj ET EMC',
      '/Figure <</MCID 2>> BDC 20 200 100 80 re f EMC',
      '/Artifact BMC BT /F1 8 Tf 140 10 Td (1) Tj ET EMC'
    ].join('\n')
  )
  setContent(
    p2,
    ['/H3 <</MCID 0>> BDC BT /F1 14 Tf 20 360 Td (A deeper heading) Tj ET EMC', '/P <</MCID 1>> BDC BT /F1 11 Tf 20 330 Td (Second page text.) Tj ET EMC'].join('\n')
  )
  p1.node.set(PDFName.of('StructParents'), ctx.obj(0))
  p2.node.set(PDFName.of('StructParents'), ctx.obj(1))

  const root = ctx.nextRef()
  const docEl = ctx.nextRef()
  const elem = (type: string, page: PDFRef, mcid: number, extra: Record<string, unknown> = {}) =>
    ctx.register(ctx.obj({ Type: 'StructElem', S: type, P: docEl, Pg: page, K: mcid, ...extra }))
  const h1 = elem('H1', p1.ref, 0)
  const para1 = elem('P', p1.ref, 1)
  const fig = elem('Figure', p1.ref, 2, o.figureAlt ? { Alt: PDFString.of(o.figureAlt) } : {})
  const h3 = elem('H3', p2.ref, 0)
  const para2 = elem('P', p2.ref, 1)
  ctx.assign(docEl, ctx.obj({ Type: 'StructElem', S: 'Document', P: root, K: [h1, para1, fig, h3, para2] }))
  const nums = ctx.obj([0, [h1, para1, fig], 1, [h3, para2]]) as PDFArray
  ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: docEl, ParentTree: { Nums: nums } }))
  doc.catalog.set(PDFName.of('StructTreeRoot'), root)
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }))
  if (o.lang) doc.catalog.set(PDFName.of('Lang'), PDFString.of(o.lang))
  if (o.title) {
    doc.setTitle(o.title)
    doc.catalog.set(PDFName.of('ViewerPreferences'), ctx.obj({ DisplayDocTitle: true }))
  }
  if (o.untaggedLink) {
    const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, 100, 120, 120], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.com/') } }))
    p1.node.set(PDFName.of('Annots'), ctx.obj([link]))
  }
  return doc.save()
}
