import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { bytesToString, isShow, parseContent, showBytes } from './content'
import { replaceBlock, wrapText, type TextStyle } from './textEdit'

const style: TextStyle = { font: 'Helvetica', flags: 32, weight: 0, italic: false, size: 12, color: '#000000', matrix: [1, 0, 0, 1, 40, 250] }

async function shows(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const c = doc.getPage(0).node.lookup(PDFName.of('Contents'))
  const parts = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i)) : [c]
  const src = parts.map((p) => (p instanceof PDFRawStream ? bytesToString(decodePDFRawStream(p).decode()) : '')).join('\n')
  return parseContent(src).filter(isShow).map(showBytes)
}

describe('wrapText', () => {
  const six = (s: string) => s.length * 6
  it('wraps greedily to the width', () => {
    expect(wrapText('one two three four five', six, 60, 60)).toEqual(['one two', 'three four', 'five'])
  })
  it('keeps newlines and leaves an over-long word on its own line', () => {
    expect(wrapText('aa bb\ncc dd ee', six, 36, 36)).toEqual(['aa bb', 'cc dd', 'ee'])
    expect(wrapText('short supercalifragilistic end', six, 60, 60)).toEqual(['short', 'supercalifragilistic', 'end'])
  })
  it('uses a narrower first line for an indent', () => {
    expect(wrapText('aaa bbb ccc ddd', six, 36, 72)).toEqual(['aaa', 'bbb ccc ddd'])
  })
  it('keeps blank lines', () => {
    expect(wrapText('a\n\nb', six, 60, 60)).toEqual(['a', '', 'b'])
  })
})

describe('replaceBlock', () => {
  async function paragraph(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 300])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (const [i, t] of ['The first line of', 'a short paragraph that', 'goes on a bit more.'].entries()) page.drawText(t, { x: 40, y: 250 - i * 14, size: 12, font })
    page.drawText('Footer', { x: 40, y: 40, size: 12, font })
    return doc.save()
  }
  const origins = [250, 236, 222].map((y) => ({ x: 40, y }))
  const target = { page: 0, ordinals: [0, 1, 2], total: 4, origins }
  const layout = { firstX: 40, restX: 40, baselineY: 250, leading: 14, width: 120 }

  it('rewraps a paragraph to its width and leaves the rest of the page alone', async () => {
    const out = await replaceBlock(await paragraph(), target, 'A completely different paragraph of text that must wrap onto several lines nicely.', style, null, layout)
    const lines = await shows(out.bytes)
    expect(lines.filter((l) => l !== 'Footer').join(' ')).toBe('A completely different paragraph of text that must wrap onto several lines nicely.')
    expect(lines.filter((l) => l !== 'Footer').length).toBeGreaterThan(3)
    expect(lines).toContain('Footer')
    expect(lines.some((l) => l.includes('first line'))).toBe(false)
    // Each drawn line fits the paragraph width (Helvetica 12 pt, 120 pt wide).
    const doc = await PDFDocument.create()
    const f = await doc.embedFont(StandardFonts.Helvetica)
    for (const l of lines.filter((x) => x !== 'Footer')) expect(f.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(120.5)
  })

  it('deletes a whole paragraph when the text is empty', async () => {
    const out = await replaceBlock(await paragraph(), target, '', style, null, layout)
    expect(await shows(out.bytes)).toEqual(['Footer'])
  })

  it('checks every line of the paragraph against PDFium', async () => {
    const bad = { ...target, origins: [origins[0], { x: 40, y: 200 }, origins[2]] }
    await expect(replaceBlock(await paragraph(), bad, 'x', style, null, layout)).rejects.toThrow(/page changed/)
  })

  it('does not wrap a single line', async () => {
    const one = { page: 0, ordinals: [3], total: 4, origins: [{ x: 40, y: 40 }] }
    const out = await replaceBlock(await paragraph(), one, 'A very long single line of replacement text that stays on one line', { ...style, matrix: [1, 0, 0, 1, 40, 40] }, null, null)
    expect((await shows(out.bytes)).filter((l) => l.startsWith('A very long')).length).toBe(1)
  })
})
