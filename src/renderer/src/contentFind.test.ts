import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { findReplaceText, searchPattern } from './contentFind'
import { pageContent } from './pageContent'

async function sample(draw: (p: ReturnType<PDFDocument['addPage']>, font: Awaited<ReturnType<PDFDocument['embedFont']>>) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([300, 200])
  draw(p1, font)
  const p2 = doc.addPage([300, 200])
  p2.drawText('Another hello here', { font, size: 10, x: 10, y: 100 })
  return doc.save()
}

describe('searchPattern', () => {
  it('escapes, ignores case by default and can match whole words', () => {
    expect('a.b A.B'.match(searchPattern({ find: 'a.b', matchCase: false, wholeWord: false }))).toHaveLength(2)
    expect('a.b A.B'.match(searchPattern({ find: 'a.b', matchCase: true, wholeWord: false }))).toHaveLength(1)
    expect('cat concat cat.'.match(searchPattern({ find: 'cat', matchCase: false, wholeWord: true }))).toHaveLength(2)
  })
})

describe('findReplaceText', () => {
  it('replaces text on every page through the font and leaves the rest alone', async () => {
    const bytes = await sample((p, font) => {
      p.drawText('Hello World, hello again', { font, size: 12, x: 10, y: 100 })
      p.drawText('Nothing here', { font, size: 12, x: 10, y: 50 })
    })
    const r = await findReplaceText(bytes, { find: 'hello', replace: 'Goodbye', matchCase: false, wholeWord: false })
    expect(r.replaced).toBe(3)
    expect(r.pages).toEqual([0, 1])
    const doc = await PDFDocument.load(r.bytes)
    const first = pageContent(doc.getPage(0))
    // Text is written as hex codes; decode what the page now shows.
    const shown = [...first.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map((m) => m[1].match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join(''))
    expect(shown).toContain('Goodbye World, Goodbye again')
    expect(shown).toContain('Nothing here')
  })
  it('honours match case and counts replacements the font cannot show', async () => {
    const bytes = await sample((p, font) => p.drawText('Price: 10', { font, size: 12, x: 10, y: 100 }))
    const none = await findReplaceText(bytes, { find: 'price', replace: 'Cost', matchCase: true, wholeWord: false })
    expect(none.replaced).toBe(0)
    const bad = await findReplaceText(bytes, { find: 'Price', replace: 'Prix 中', matchCase: true, wholeWord: false })
    expect(bad.replaced).toBe(0)
    expect(bad.skipped[0].count).toBe(1)
  })
  it('does nothing for an empty search', async () => {
    const bytes = await sample(() => {})
    expect((await findReplaceText(bytes, { find: '', replace: 'x', matchCase: false, wholeWord: false })).replaced).toBe(0)
  })
})
