import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { createPortfolio, embedFiles, isPortfolio, mimeFor, removeEmbedded } from './portfolio'

const enc = (s: string) => new TextEncoder().encode(s)

async function plain(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  return doc.save()
}

/** Name -> contents of the document-level embedded files, read back through pdf-lib. */
async function embedded(bytes: Uint8Array): Promise<Map<string, string>> {
  const doc = await PDFDocument.load(bytes)
  const tree = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  const names = tree?.lookupMaybe(PDFName.of('Names'), PDFArray)
  const out = new Map<string, string>()
  if (!names) return out
  for (let i = 0; i + 1 < names.size(); i += 2) {
    const key = (names.lookup(i) as unknown as { decodeText(): string }).decodeText()
    const spec = names.lookup(i + 1) as PDFDict
    const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict)!
    const stream = ef.lookup(PDFName.of('F')) as PDFRawStream
    out.set(key, new TextDecoder().decode(decodePDFRawStream(stream).decode()))
  }
  return out
}

describe('mimeFor', () => {
  it('knows common types and falls back to octet-stream', () => {
    expect(mimeFor('a.PDF')).toBe('application/pdf')
    expect(mimeFor('sheet.xlsx')).toContain('spreadsheetml')
    expect(mimeFor('mystery.xyz')).toBe('application/octet-stream')
    expect(mimeFor('noextension')).toBe('application/octet-stream')
  })
})

describe('embedFiles and removeEmbedded', () => {
  it('embeds files with their contents, kept in name order', async () => {
    const out = await embedFiles(await plain(), [
      { name: 'zebra.txt', data: enc('Z file') },
      { name: 'apple.txt', data: enc('A file'), description: 'First fruit' }
    ])
    expect([...(await embedded(out)).entries()]).toEqual([
      ['apple.txt', 'A file'],
      ['zebra.txt', 'Z file']
    ])
  })

  it('numbers a name that is already used and adds to what is there', async () => {
    const one = await embedFiles(await plain(), [{ name: 'notes.txt', data: enc('first') }])
    const two = await embedFiles(one, [{ name: 'notes.txt', data: enc('second') }])
    expect([...(await embedded(two)).keys()]).toEqual(['notes (2).txt', 'notes.txt'])
  })

  it('removes one file and leaves the others; its data does not stay in the file', async () => {
    const out = await embedFiles(await plain(), [
      { name: 'a.txt', data: enc('KEEP ME') },
      { name: 'b.txt', data: enc('SECRET PAYLOAD 12345') }
    ])
    const r = await removeEmbedded(out, 1, 'b.txt')
    expect(r.removed).toBe(true)
    expect([...(await embedded(r.bytes)).keys()]).toEqual(['a.txt'])
    expect(Buffer.from(r.bytes).includes(Buffer.from('SECRET PAYLOAD'))).toBe(false)
    // A wrong name or index changes nothing.
    expect((await removeEmbedded(out, 1, 'a.txt')).removed).toBe(false)
    expect((await removeEmbedded(out, 7)).removed).toBe(false)
  })

  it('removes the whole tree when the last file goes', async () => {
    const out = await embedFiles(await plain(), [{ name: 'only.txt', data: enc('x') }])
    const r = await removeEmbedded(out, 0, 'only.txt')
    expect((await embedded(r.bytes)).size).toBe(0)
  })
})

describe('createPortfolio', () => {
  it('makes a cover page with the files embedded and a collection entry', async () => {
    const bytes = await createPortfolio(
      [
        { name: 'contract.pdf', data: enc('%PDF-1.4 fake') },
        { name: 'drawings.zip', data: enc('PK fake') }
      ],
      { title: 'Project pack', cover: 'Tender documents\nIssued for review' }
    )
    expect(await isPortfolio(bytes)).toBe(true)
    expect(await isPortfolio(await plain())).toBe(false)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getTitle()).toBe('Project pack')
    expect(doc.getPageCount()).toBe(1)
    expect([...(await embedded(bytes)).keys()]).toEqual(['contract.pdf', 'drawings.zip'])
  })
})
