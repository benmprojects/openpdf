import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addFolder, checkFolderName, cleanFolderPath, createPortfolio, embedFiles, moveToFolder, readPortfolio, removeFolder, renameFolder } from './portfolio'

const enc = (s: string) => new TextEncoder().encode(s)
const files = [
  { name: 'a.txt', data: enc('a'), folder: 'Drawings' },
  { name: 'b.txt', data: enc('b'), folder: 'Drawings/Civil' },
  { name: 'c.txt', data: enc('c') }
]

describe('portfolio folders', () => {
  it('writes folders and says where each file is', async () => {
    const bytes = await createPortfolio(files, { title: 'Pack', cover: '' })
    const p = await readPortfolio(bytes)
    expect(p.isPortfolio).toBe(true)
    expect(p.view).toBe('D')
    expect(p.folders).toEqual(['Drawings', 'Drawings/Civil'])
    expect(p.assign).toEqual({ 'a.txt': 'Drawings', 'b.txt': 'Drawings/Civil', 'c.txt': '' })
  })

  it('writes a folder tree with parents, children and siblings, and the file entries point at folders', async () => {
    const bytes = await createPortfolio([...files, { name: 'd.txt', data: enc('d'), folder: 'Specs' }], { title: 'Pack', cover: '', view: 'T' })
    const doc = await PDFDocument.load(bytes)
    const col = doc.catalog.lookupMaybe(PDFName.of('Collection'), PDFDict)!
    expect((col.lookup(PDFName.of('View')) as PDFName).decodeText()).toBe('T')
    const root = col.lookupMaybe(PDFName.of('Folders'), PDFDict)!
    expect(root.has(PDFName.of('Parent'))).toBe(false)
    const first = root.lookupMaybe(PDFName.of('Child'), PDFDict)!
    expect(first.has(PDFName.of('Next'))).toBe(true)
    expect(first.has(PDFName.of('Parent'))).toBe(true)
    expect(first.lookup(PDFName.of('Type'))).toBe(PDFName.of('Folder'))
  })

  it('has no folders unless asked for', async () => {
    const p = await readPortfolio(await createPortfolio([{ name: 'x.txt', data: enc('x') }], { title: 'P', cover: '' }))
    expect(p.folders).toEqual([])
    expect(await readPortfolio(await (async () => { const d = await PDFDocument.create(); d.addPage(); return d.save() })())).toMatchObject({ isPortfolio: false })
  })

  it('adds, moves, renames and removes folders', async () => {
    let bytes = await createPortfolio([{ name: 'x.txt', data: enc('x') }, { name: 'y.txt', data: enc('y') }], { title: 'P', cover: '' })
    bytes = await addFolder(bytes, 'Reports/2026')
    expect((await readPortfolio(bytes)).folders).toEqual(['Reports', 'Reports/2026'])
    bytes = await moveToFolder(bytes, 'x.txt', 'Reports/2026')
    bytes = await moveToFolder(bytes, 'y.txt', 'Other')
    let p = await readPortfolio(bytes)
    expect(p.assign).toEqual({ 'x.txt': 'Reports/2026', 'y.txt': 'Other' })
    bytes = await renameFolder(bytes, 'Reports', 'Annual')
    p = await readPortfolio(bytes)
    expect(p.folders).toEqual(['Annual', 'Annual/2026', 'Other'])
    expect(p.assign['x.txt']).toBe('Annual/2026')
    bytes = await removeFolder(bytes, 'Annual')
    p = await readPortfolio(bytes)
    expect(p.folders).toEqual(['2026', 'Other'])
    expect(p.assign['x.txt']).toBe('2026')
    bytes = await moveToFolder(bytes, 'x.txt', '')
    bytes = await removeFolder(bytes, '2026')
    bytes = await removeFolder(bytes, 'Other')
    p = await readPortfolio(bytes)
    expect(p.folders).toEqual([])
    expect(p.assign).toEqual({ 'x.txt': '', 'y.txt': '' })
  })

  it('refuses bad folder work and a document that is not a portfolio', async () => {
    const bytes = await createPortfolio(files, { title: 'P', cover: '' })
    await expect(addFolder(bytes, 'Drawings')).rejects.toThrow(/already/)
    await expect(addFolder(bytes, '   ')).rejects.toThrow()
    await expect(moveToFolder(bytes, 'missing.txt', 'X')).rejects.toThrow(/not in the portfolio/)
    await expect(renameFolder(bytes, 'Drawings', 'a/b')).rejects.toThrow(/slash/)
    const d = await PDFDocument.create()
    d.addPage()
    await expect(addFolder(await d.save(), 'X')).rejects.toThrow(/not a portfolio/)
  })

  it('puts files added later in the folder they are given', async () => {
    let bytes = await createPortfolio(files, { title: 'P', cover: '' })
    bytes = await embedFiles(bytes, [{ name: 'e.txt', data: enc('e'), folder: 'Specs' }, { name: 'a.txt', data: enc('again'), folder: 'Drawings' }])
    const p = await readPortfolio(bytes)
    expect(p.assign['e.txt']).toBe('Specs')
    expect(p.assign['a.txt']).toBe('Drawings')
    expect(p.assign['a (2).txt']).toBe('Drawings')
  })

  it('embeds a picture of a file when given one', async () => {
    const rgb = new Uint8Array(2 * 2 * 3).fill(200)
    const bytes = await createPortfolio([{ name: 'p.pdf', data: enc('x'), thumb: { width: 2, height: 2, rgb } }], { title: 'P', cover: '' })
    const doc = await PDFDocument.load(bytes)
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)!.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)!
    const spec = (names.lookup(PDFName.of('Names')) as unknown as { lookup(i: number): PDFDict }).lookup(1)
    const thumb = spec.lookup(PDFName.of('Thumb')) as PDFRawStream
    expect(thumb.dict.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Image'))
    expect(thumb.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'))
  })

  it('cleans and checks folder names', () => {
    expect(cleanFolderPath(' A / /B\C ')).toBe('A/BC')
    expect(checkFolderName('ok')).toBeNull()
    expect(checkFolderName('a/b')).toMatch(/slash/)
    expect(checkFolderName('')).toBeTruthy()
    expect(checkFolderName('x'.repeat(101))).toMatch(/100/)
  })
})
