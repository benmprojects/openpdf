import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanFileName } from '../shared/fileNames'
import { renameDocument, trashDocument } from './fileOps'

const dir = mkdtempSync(join(tmpdir(), 'openpdf-fileops-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const make = (name: string, text = 'x') => {
  const p = join(dir, name)
  writeFileSync(p, text)
  return p
}

describe('cleanFileName', () => {
  it('adds .pdf once and trims', () => {
    expect(cleanFileName('  Report  ')).toEqual({ name: 'Report.pdf', error: null })
    expect(cleanFileName('Report.PDF').name).toBe('Report.pdf')
  })
  it('refuses names Windows would not accept', () => {
    for (const bad of ['', '   ', 'a/b', 'a:b', 'what?', 'name.', 'CON', 'nul.txt', 'x'.repeat(130)]) expect(cleanFileName(bad).error).toBeTruthy()
  })
})

describe('renameDocument', () => {
  it('renames in the same folder', async () => {
    const p = make('one.pdf', 'ONE')
    const r = await renameDocument(p, 'uno')
    expect(r.name).toBe('uno.pdf')
    expect(existsSync(p)).toBe(false)
    expect(readFileSync(r.path, 'utf8')).toBe('ONE')
  })
  it('never overwrites another file', async () => {
    const a = make('a.pdf', 'A')
    const b = make('b.pdf', 'B')
    await expect(renameDocument(a, 'b')).rejects.toThrow(/already a file/)
    expect(readFileSync(a, 'utf8')).toBe('A')
    expect(readFileSync(b, 'utf8')).toBe('B')
  })
  it('refuses a name with a folder in it, and files that are not PDFs or not there', async () => {
    const p = make('c.pdf')
    await expect(renameDocument(p, '..\\evil')).rejects.toThrow()
    await expect(renameDocument(join(dir, 'missing.pdf'), 'x')).rejects.toThrow(/not there/)
    await expect(renameDocument(make('notes.txt'), 'x')).rejects.toThrow(/Only .pdf/)
  })
})

describe('trashDocument', () => {
  it('hands the file to the Recycle Bin function and does nothing else', async () => {
    const p = make('gone.pdf')
    const seen: string[] = []
    await trashDocument(p, async (x) => void seen.push(x))
    expect(seen).toEqual([p])
    expect(existsSync(p)).toBe(true) // only the injected bin function would remove it
  })
  it('refuses anything that is not an existing PDF', async () => {
    await expect(trashDocument(join(dir, 'nope.pdf'), async () => undefined)).rejects.toThrow()
    await expect(trashDocument(dir, async () => undefined)).rejects.toThrow()
    await expect(trashDocument(make('x.docx'), async () => undefined)).rejects.toThrow()
  })
})
