import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addLayer, deleteLayer, flattenLayers, mergeLayers, renameLayer } from './layersEdit'
import { readLayers, withHiddenLayers } from './layers'
import { pageContent } from './pageContent'

/** A page with two layers: "Plan" (on) and "Notes" (off), and a third "Dims" (on). */
async function layered(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const ctx = doc.context
  const plan = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Plan') }))
  const notes = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Notes') }))
  const dims = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Dims') }))
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [plan, notes, dims], D: { Order: [plan, notes, dims], OFF: [notes], BaseState: 'ON' } }))
  const page = doc.addPage([200, 200])
  page.node.set(PDFName.of('Resources'), ctx.obj({ Properties: { P1: plan, N1: notes, D1: dims } }))
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('/OC /P1 BDC 0 0 10 10 re f EMC /OC /N1 BDC 20 20 10 10 re f EMC /OC /D1 BDC 40 40 10 10 re f EMC 60 60 5 5 re f')))
  return doc.save()
}

describe('layer editing', () => {
  it('renames and adds layers', async () => {
    const r = await renameLayer(await layered(), (await readLayers(await layered()))[0].key, 'Site plan')
    expect((await readLayers(r))[0].name).toBe('Site plan')
    const added = await addLayer(r, 'Markup')
    const names = (await readLayers(added.bytes)).map((l) => l.name)
    expect(names).toEqual(['Site plan', 'Notes', 'Dims', 'Markup'])
    expect((await readLayers(added.bytes)).find((l) => l.key === added.key)!.defaultOn).toBe(true)
  })

  it('writes the opening state', async () => {
    const bytes = await layered()
    const layers = await readLayers(bytes)
    const out = await withHiddenLayers(bytes, new Set([layers[0].key]))
    const after = await readLayers(out)
    expect(after.map((l) => l.defaultOn)).toEqual([false, true, true])
  })

  it('deletes a layer and keeps its content, or removes it', async () => {
    const bytes = await layered()
    const key = (await readLayers(bytes))[1].key
    const kept = await deleteLayer(bytes, key, 'keep')
    expect(kept.change).toEqual({ removed: 0, unwrapped: 1 })
    expect((await readLayers(kept.bytes)).map((l) => l.name)).toEqual(['Plan', 'Dims'])
    expect(pageContent((await PDFDocument.load(kept.bytes)).getPage(0))).toContain('20 20 10 10 re f')
    const gone = await deleteLayer(bytes, key, 'remove')
    expect(gone.change.removed).toBe(1)
    expect(pageContent((await PDFDocument.load(gone.bytes)).getPage(0))).not.toContain('20 20 10 10')
    expect(pageContent((await PDFDocument.load(gone.bytes)).getPage(0))).toContain('0 0 10 10 re f')
  })

  it('merges layers into one', async () => {
    const bytes = await layered()
    const [plan, notes, dims] = await readLayers(bytes)
    const out = await mergeLayers(bytes, [notes.key, dims.key], plan.key)
    expect(out.merged).toBe(2)
    const after = await readLayers(out.bytes)
    expect(after.map((l) => l.name)).toEqual(['Plan'])
    // The page still marks its three pieces, now all on the one layer.
    const doc = await PDFDocument.load(out.bytes)
    const props = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Properties')) as unknown as { entries(): [PDFName, unknown][] }
    const refs = new Set(props.entries().map(([, v]) => String(v)))
    expect(refs.size).toBe(1)
  })

  it('flattens to the opening state: hidden content goes, visible stays, layers are gone', async () => {
    const r = await flattenLayers(await layered())
    expect(r.layers).toBe(3)
    expect(r.change).toEqual({ removed: 1, unwrapped: 2 })
    const doc = await PDFDocument.load(r.bytes)
    const src = pageContent(doc.getPage(0))
    expect(src).not.toContain('20 20 10 10')
    expect(src).toContain('0 0 10 10 re f')
    expect(src).toContain('40 40 10 10 re f')
    expect(src).not.toContain('BDC')
    expect(doc.catalog.has(PDFName.of('OCProperties'))).toBe(false)
    expect(await readLayers(r.bytes)).toEqual([])
  })
})
