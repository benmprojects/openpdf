import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { readViewPrefs, writeViewPrefs } from './viewPrefs'

async function blank(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([200, 200])
  return d.save()
}

describe('base URL and trapped', () => {
  it('round-trips both', async () => {
    const b = await blank()
    const v = await readViewPrefs(b)
    expect(v.baseUrl).toBe('')
    expect(v.trapped).toBe('Unknown')
    const out = await writeViewPrefs(b, { ...v, baseUrl: 'https://example.com/docs/', trapped: 'False' })
    const back = await readViewPrefs(out)
    expect(back.baseUrl).toBe('https://example.com/docs/')
    expect(back.trapped).toBe('False')
    const doc = await PDFDocument.load(out)
    expect(doc.catalog.lookupMaybe(PDFName.of('URI'), PDFDict)).toBeDefined()
  })

  it('removes them again', async () => {
    const v = await readViewPrefs(await blank())
    const set = await writeViewPrefs(await blank(), { ...v, baseUrl: 'https://example.com/', trapped: 'True' })
    const cleared = await writeViewPrefs(set, { ...(await readViewPrefs(set)), baseUrl: '', trapped: 'Unknown' })
    const back = await readViewPrefs(cleared)
    expect(back.baseUrl).toBe('')
    expect(back.trapped).toBe('Unknown')
    expect((await PDFDocument.load(cleared)).catalog.has(PDFName.of('URI'))).toBe(false)
  })
})
