import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { checkCustomProps, listFonts, readCustomProps, writeCustomProps } from './docExtras'
import { readProps, writeProps, EMPTY_PROPS } from './metadata'

async function blank(pages = 2): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([200, 200])
  return d.save()
}

describe('custom properties', () => {
  it('adds, edits and deletes custom keys without touching the standard ones', async () => {
    const titled = await writeProps(await blank(), { ...EMPTY_PROPS, title: 'Plans' })
    const one = await writeCustomProps(titled, [{ key: 'Project', value: 'Example park' }, { key: 'Stage', value: 'Draft' }])
    expect(await readCustomProps(one)).toEqual([{ key: 'Project', value: 'Example park' }, { key: 'Stage', value: 'Draft' }])
    expect((await readProps(one)).title).toBe('Plans')
    const two = await writeCustomProps(one, [{ key: 'Stage', value: 'Final' }])
    expect(await readCustomProps(two)).toEqual([{ key: 'Stage', value: 'Final' }])
    const none = await writeCustomProps(two, [])
    expect(await readCustomProps(none)).toEqual([])
    expect((await readProps(none)).title).toBe('Plans')
  })

  it('keeps non-ASCII values', async () => {
    const out = await writeCustomProps(await blank(), [{ key: 'Note', value: 'Café – 100 % ✓' }])
    expect((await readCustomProps(out))[0].value).toBe('Café – 100 % ✓')
  })

  it('refuses empty, repeated and standard names', () => {
    expect(checkCustomProps([{ key: ' ', value: '' }])).toMatch(/needs a name/)
    expect(checkCustomProps([{ key: 'A', value: '' }, { key: 'A', value: '' }])).toMatch(/twice/)
    expect(checkCustomProps([{ key: 'title', value: '' }])).toMatch(/standard/)
    expect(checkCustomProps([{ key: 'Project', value: 'x' }])).toBeNull()
  })
})

describe('fonts', () => {
  it('lists fonts with type, embedding and the pages that use them', async () => {
    const d = await PDFDocument.create()
    const p1 = d.addPage([200, 200])
    const p2 = d.addPage([200, 200])
    const helv = await d.embedFont(StandardFonts.Helvetica)
    const times = await d.embedFont(StandardFonts.TimesRoman)
    p1.drawText('A', { font: helv, size: 12 })
    p2.drawText('B', { font: helv, size: 12 })
    p2.drawText('C', { font: times, size: 12 })
    const fonts = await listFonts(await d.save())
    const h = fonts.find((f) => f.name === 'Helvetica')!
    expect(h).toMatchObject({ type: 'Type 1', embedded: false, subset: false, pages: [1, 2] })
    expect(fonts.find((f) => f.name === 'Times-Roman')!.pages).toEqual([2])
  })

  it('names a subset font without its prefix', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([100, 100])
    const helv = await d.embedFont(StandardFonts.Helvetica)
    p.drawText('A', { font: helv, size: 10 })
    const d2 = await PDFDocument.load(await d.save())
    for (const [, o] of d2.context.enumerateIndirectObjects()) {
      if (o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font')) o.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+Helvetica'))
    }
    const fonts = await listFonts(await d2.save())
    expect(fonts[0]).toMatchObject({ name: 'Helvetica', subset: true, embedded: false })
  })

  it('returns nothing for a page without text', async () => {
    expect(await listFonts(await blank())).toEqual([])
  })
})
