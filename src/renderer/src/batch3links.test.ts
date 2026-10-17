import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { annotDicts, linkTargetOf } from './annotExtras'
import { writeAnnotations } from './annotWrite'
import { withBounds, type Annot } from './annotations'
import type { LinkAction } from './linkLogic'

let nextId = 1
const link = (extra: Partial<Annot>): Annot => withBounds({ id: nextId++, page: 0, kind: 'link', color: '#000000', rects: [{ x: 20, y: 20, w: 80, h: 14 }], text: '', fontSize: 12, lineWidth: 1, ...extra })

async function blank(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([300, 300])
  d.addPage([300, 300])
  return d.save()
}

/** Writes the links, then reads them back the way the importer does. */
async function roundTrip(links: Annot[]) {
  const out = await writeAnnotations(await blank(), links)
  const dicts = (await annotDicts(out))![0]
  return { out, targets: dicts.map((d) => linkTargetOf(d)) }
}

describe('links with actions are saved and read back', () => {
  it('file, script and named destination', async () => {
    const actions: LinkAction[] = [
      { kind: 'file', path: 'Plans/site.pdf' },
      { kind: 'js', code: 'console.println("x");' },
      { kind: 'named', name: 'Missing' }
    ]
    const { out, targets } = await roundTrip(actions.map((a) => link({ linkAction: a })))
    expect(targets.map((t) => t?.action)).toEqual(actions)
    const doc = await PDFDocument.load(out)
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray)
    const first = annots.lookup(0, PDFDict).lookup(PDFName.of('A'), PDFDict)
    expect(first.lookup(PDFName.of('S'))).toBe(PDFName.of('Launch'))
  })

  it('a named destination that exists keeps its name and its page', async () => {
    const d = await PDFDocument.load(await blank())
    const dest = d.context.obj([d.getPage(1).ref, 'Fit'])
    d.catalog.set(PDFName.of('Dests'), d.context.obj({ Chapter: dest }))
    const start = await d.save()
    const out = await writeAnnotations(start, [link({ linkAction: { kind: 'named', name: 'Chapter' } })])
    const target = linkTargetOf((await annotDicts(out))![0][0])
    expect(target).toEqual({ page: 1, action: { kind: 'named', name: 'Chapter' } })
  })

  it('an ordinary page link carries no action', async () => {
    const { targets } = await roundTrip([link({ linkPage: 1 }), link({ linkUri: 'https://example.com/' })])
    expect(targets[0]).toEqual({ page: 1 })
    expect(targets[1]).toEqual({ uri: 'https://example.com/' })
  })
})

describe('links from barcodes', () => {
  it('puts a link over a barcode whose text is a web address, and only then', async () => {
    const { placeBarcodes } = await import('./barcodeWrite')
    const rect = { x: 20, y: 20, w: 60, h: 60 }
    const out = await placeBarcodes(await blank(), [
      { page: 0, rect, style: { kind: 'qr', text: 'https://example.com/drawing/101' }, as: 'content', link: true },
      { page: 0, rect: { ...rect, y: 120 }, style: { kind: 'qr', text: 'Not a link' }, as: 'content', link: true },
      { page: 1, rect, style: { kind: 'qr', text: 'https://example.com/other' }, as: 'annotation' }
    ])
    const doc = await PDFDocument.load(out)
    const annots = (page: number) => doc.getPage(page).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    expect(annots(0)!.size()).toBe(1)
    const link = annots(0)!.lookup(0, PDFDict)
    expect(link.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Link'))
    expect(link.lookupMaybe(PDFName.of('A'), PDFDict)!.lookup(PDFName.of('S'))).toBe(PDFName.of('URI'))
    // Without the option, only the stamp is added.
    expect(annots(1)!.size()).toBe(1)
    expect(annots(1)!.lookup(0, PDFDict).lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Stamp'))
  })
})
