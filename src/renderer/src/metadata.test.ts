import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { pdfDateToIso, readProps, readXmp, removeProps, writeProps, EMPTY_PROPS } from './metadata'

async function blank(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([200, 200])
  return d.save()
}

describe('metadata', () => {
  it('reads PDF dates with and without a zone', () => {
    expect(pdfDateToIso("D:20261015164900+10'00'")).toBe('2026-10-15T16:49:00+10:00')
    expect(pdfDateToIso('D:20261015')).toBe('2026-10-15T00:00:00Z')
    expect(pdfDateToIso('nonsense')).toBe('')
  })

  it('writes the Info entries and a matching XMP packet, and reads them back', async () => {
    const props = { ...EMPTY_PROPS, title: 'Plans & specs <v2>', author: 'Jane Citizen', keywords: 'civil, parks', created: '2026-10-15T06:00:00Z' }
    const out = await writeProps(await blank(), props)
    const back = await readProps(out)
    expect(back.title).toBe('Plans & specs <v2>')
    expect(back.author).toBe('Jane Citizen')
    expect(back.keywords).toBe('civil, parks')
    expect(back.created).toBe('2026-10-15T06:00:00Z')
    expect(back.subject).toBe('')
    const xmp = await readXmp(out)
    expect(xmp).toContain('Plans &amp; specs &lt;v2&gt;')
    expect(xmp).toContain('<xmp:CreateDate>2026-10-15T06:00:00Z</xmp:CreateDate>')
  })

  it('removes entries that are emptied, and everything on request', async () => {
    const once = await writeProps(await blank(), { ...EMPTY_PROPS, title: 'A', author: 'B' })
    const twice = await writeProps(once, { ...EMPTY_PROPS, title: 'A' })
    expect((await readProps(twice)).author).toBe('')
    const bare = await removeProps(twice)
    expect(await readProps(bare)).toEqual(EMPTY_PROPS)
    expect(await readXmp(bare)).toBe('')
  })

  it('copes with a file that has no Info dictionary at all', async () => {
    const d = await PDFDocument.create()
    d.addPage([200, 200])
    delete (d.context.trailerInfo as { Info?: unknown }).Info
    const bare = await d.save()
    expect(await readProps(bare)).toEqual(EMPTY_PROPS)
    expect((await readProps(await writeProps(bare, { ...EMPTY_PROPS, title: 'T' }))).title).toBe('T')
    expect(await readProps(await removeProps(bare))).toEqual(EMPTY_PROPS)
  })
})
