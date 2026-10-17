import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { textFileToPdf } from './createPdf'
import { csvToTable, markdownToText, parseCsv, rtfToText, textKindOf } from './textConvert'

describe('textKindOf', () => {
  it('goes by the extension', () => {
    expect(textKindOf('a.RTF')).toBe('rtf')
    expect(textKindOf('a.md')).toBe('md')
    expect(textKindOf('a.tsv')).toBe('csv')
    expect(textKindOf('a.log')).toBe('txt')
  })
})

describe('rtfToText', () => {
  it('keeps the words, drops the settings and decodes escapes', () => {
    const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}{\*\generator Test;}\pard Caf\'e9 \b bold\b0 \u8364?\par Second line\tab tab\par}`
    expect(rtfToText(rtf)).toBe('Café bold€\nSecond line\ttab')
  })
  it('turns table cells into tabs and rows into lines', () => {
    expect(rtfToText(String.raw`{\rtf1 A\cell B\cell\row C\cell D\cell\row}`)).toBe('A\tB\nC\tD')
  })
  it('passes plain text through', () => {
    expect(rtfToText('just text')).toBe('just text')
  })
})

describe('markdownToText', () => {
  it('removes markers and keeps meaning', () => {
    const t = markdownToText('# Title\n\nSome **bold** and *italic* with [a link](https://example.com).\n\n- one\n- two\n\n```\ncode here\n```')
    expect(t).toContain('TITLE')
    expect(t).toContain('Some bold and italic with a link (https://example.com).')
    expect(t).toContain('• one')
    expect(t).toContain('    code here')
    expect(t).not.toContain('**')
  })
  it('reads pipe tables as columns', () => {
    expect(markdownToText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a   b\n1   2')
  })
})

describe('csv', () => {
  it('parses quotes, doubled quotes and embedded breaks', () => {
    expect(parseCsv('a,"b,c","d ""q"""\n1,2,3\n')).toEqual([['a', 'b,c', 'd "q"'], ['1', '2', '3']])
    expect(parseCsv('x;y\n1;2')).toEqual([['x', 'y'], ['1', '2']])
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']])
  })
  it('aligns columns and shrinks the type to fit', () => {
    const r = csvToTable('name,qty\nfence,12\ngate,3', { fitWidth: 480, size: 11 })
    expect(r.text.split('\n')[1]).toBe('fence  12')
    expect(r.size).toBe(11)
    const wide = csvToTable(`${'a'.repeat(40)},${'b'.repeat(40)},${'c'.repeat(40)}`, { fitWidth: 480, size: 11 })
    expect(wide.size).toBeLessThan(11)
    expect(wide.size).toBeGreaterThanOrEqual(6)
  })
  it('cuts very long cells and counts them', () => {
    expect(csvToTable(`${'x'.repeat(100)},y`, { fitWidth: 480, size: 11 }).cut).toBe(1)
  })
})

describe('textFileToPdf', () => {
  it('makes a PDF from each kind', async () => {
    const enc = new TextEncoder()
    for (const [name, body] of [['a.rtf', String.raw`{\rtf1 Hello\par}`], ['a.md', '# Hi\n\ntext'], ['a.csv', 'a,b\n1,2'], ['a.txt', 'plain']] as const) {
      const out = await textFileToPdf(name, enc.encode(body), { font: 'Helvetica', size: 11 })
      expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
    }
  })
})
