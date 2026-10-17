import { PDFArray, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addDestination, checkDestinationName, deleteDestination, moveDestination, readDestinations, renameDestination } from './destinations'

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const pages = [doc.addPage([600, 800]), doc.addPage([600, 800]), doc.addPage([600, 800])]
  // An old-style (PDF 1.1) dictionary of destinations, and a name tree entry, as two files might use.
  const old = doc.context.obj({})
  old.set(PDFName.of('Intro'), doc.context.obj([pages[0].ref, PDFName.of('Fit')]))
  doc.catalog.set(PDFName.of('Dests'), old)
  const arr = doc.context.obj([])
  arr.push(PDFString.of('Plans'))
  arr.push(doc.context.obj([pages[2].ref, PDFName.of('XYZ'), 72, 700, 1.5]))
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: doc.context.obj({ Names: arr }) }))
  return doc.save()
}

describe('readDestinations', () => {
  it('reads both the name tree and the old dictionary', async () => {
    const got = await readDestinations(await sample())
    expect(got.map((d) => d.name)).toEqual(['Intro', 'Plans'])
    expect(got[0]).toMatchObject({ page: 0, kind: 'Fit', left: null, top: null })
    expect(got[1]).toMatchObject({ page: 2, kind: 'XYZ', left: 72, top: 700, zoom: 1.5 })
  })
})

describe('addDestination', () => {
  it('adds a destination in a single sorted tree and keeps the others', async () => {
    const out = await addDestination(await sample(), { name: 'Elevations', page: 1, left: 10, top: 790, zoom: null })
    const got = await readDestinations(out)
    expect(got.map((d) => d.name)).toEqual(['Elevations', 'Intro', 'Plans'])
    expect(got[0]).toMatchObject({ page: 1, kind: 'XYZ', left: 10, top: 790, zoom: null })
    const doc = await PDFDocument.load(out)
    expect(doc.catalog.has(PDFName.of('Dests'))).toBe(false) // the old dictionary was merged into the tree
    const tree = (doc.catalog.lookup(PDFName.of('Names')) as unknown as { lookup(n: PDFName): { lookup(n: PDFName): PDFArray } }).lookup(PDFName.of('Dests'))
    expect(tree.lookup(PDFName.of('Names')).size()).toBe(6)
  })
  it('refuses a name already in use or an empty one', async () => {
    const b = await sample()
    await expect(addDestination(b, { name: 'Plans', page: 0 })).rejects.toThrow(/already exists/)
    await expect(addDestination(b, { name: '  ', page: 0 })).rejects.toThrow(/name/)
  })
  it('keeps non-ASCII names', async () => {
    const out = await addDestination(await sample(), { name: 'Pläne', page: 0 })
    expect((await readDestinations(out)).map((d) => d.name)).toContain('Pläne')
  })
})

describe('renameDestination and deleteDestination', () => {
  it('renames', async () => {
    const r = await renameDestination(await sample(), 'Plans', 'Site plan')
    expect((await readDestinations(r.bytes)).map((d) => d.name)).toEqual(['Intro', 'Site plan'])
    expect(r.orphaned).toBe(0)
  })
  it('refuses to rename onto another name or a missing one', async () => {
    await expect(renameDestination(await sample(), 'Plans', 'Intro')).rejects.toThrow(/already exists/)
    await expect(renameDestination(await sample(), 'Nope', 'X')).rejects.toThrow(/not in the document/)
  })
  it('deletes, and removes the tree when none are left', async () => {
    let b = (await deleteDestination(await sample(), 'Plans')).bytes
    expect((await readDestinations(b)).map((d) => d.name)).toEqual(['Intro'])
    b = (await deleteDestination(b, 'Intro')).bytes
    expect(await readDestinations(b)).toEqual([])
  })
  it('counts bookmarks and links that point at a deleted name', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage()
    const arr = doc.context.obj([])
    arr.push(PDFString.of('Here'))
    arr.push(doc.context.obj([p.ref, PDFName.of('Fit')]))
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: doc.context.obj({ Names: arr }) }))
    const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], Dest: PDFString.of('Here') })
    p.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]))
    const r = await deleteDestination(await doc.save(), 'Here')
    expect(r.orphaned).toBe(1)
  })
})

describe('moveDestination', () => {
  it('changes the place but not the name', async () => {
    const b = await moveDestination(await sample(), 'Intro', { page: 1, left: 0, top: 100, zoom: 2 })
    const d = (await readDestinations(b)).find((x) => x.name === 'Intro')
    expect(d).toMatchObject({ page: 1, kind: 'XYZ', top: 100, zoom: 2 })
  })
})

describe('checkDestinationName', () => {
  it('accepts a fresh name and rejects the rest', () => {
    expect(checkDestinationName('A', ['B'])).toBeNull()
    expect(checkDestinationName('B', ['B'])).not.toBeNull()
    expect(checkDestinationName('x'.repeat(200), [])).not.toBeNull()
    expect(checkDestinationName('a\nb', [])).not.toBeNull()
  })
})
