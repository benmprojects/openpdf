/**
 * Document-level JavaScript: named scripts in the catalogue's /Names /JavaScript name tree (ISO 32000 12.6.4.17). They
 * usually define functions that field scripts call; OpenPDF runs them, in the same sandbox, before each field script.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib'

export interface DocScript {
  name: string
  code: string
}

const textOf = (o: unknown): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

export function codeOf(action: PDFDict | undefined): string | undefined {
  if (!action || action.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText() !== 'JavaScript') return undefined
  const js = action.lookup(PDFName.of('JS'))
  return js instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(js).decode()) : textOf(js)
}

/** The scripts of a loaded document, in name order. */
export function docScriptsOf(doc: PDFDocument): DocScript[] {
  const out: DocScript[] = []
  const root = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('JavaScript'), PDFDict)
  const walk = (node: PDFDict | undefined, depth: number) => {
    if (!node || depth > 12) return
    const names = node.lookupMaybe(PDFName.of('Names'), PDFArray)
    for (let i = 0; names && i + 1 < names.size(); i += 2) {
      const code = codeOf(names.lookupMaybe(i + 1, PDFDict))
      if (code !== undefined) out.push({ name: textOf(names.lookup(i)), code })
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
    for (let i = 0; kids && i < kids.size(); i++) walk(kids.lookupMaybe(i, PDFDict), depth + 1)
  }
  walk(root, 0)
  return out
}

export async function readDocScripts(bytes: Uint8Array): Promise<DocScript[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  return docScriptsOf(doc)
}

/** All the scripts as one program, for the sandbox to run before a field script. */
export const joinDocScripts = (scripts: DocScript[]): string => scripts.map((s) => s.code).join('\n')

/** Replaces the document's scripts (an empty list removes them). Names must be filled in and different. */
export async function writeDocScripts(bytes: Uint8Array, scripts: DocScript[]): Promise<Uint8Array> {
  const names = scripts.map((s) => s.name.trim())
  if (names.some((n) => !n)) throw new Error('Every script needs a name.')
  if (new Set(names).size !== names.length) throw new Error('Two scripts have the same name.')
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  let top = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  if (!scripts.length) {
    top?.delete(PDFName.of('JavaScript'))
    if (top && !top.keys().length) doc.catalog.delete(PDFName.of('Names'))
  } else {
    if (!top) {
      top = ctx.obj({}) as PDFDict
      doc.catalog.set(PDFName.of('Names'), top)
    }
    // A name tree's keys are in order; one flat leaf is enough.
    const sorted = scripts.map((s, i) => ({ name: names[i], code: s.code })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const flat: unknown[] = []
    for (const s of sorted) flat.push(PDFHexString.fromText(s.name), ctx.obj({ S: 'JavaScript', JS: PDFHexString.fromText(s.code) }))
    top.set(PDFName.of('JavaScript'), ctx.obj({ Names: flat } as never))
  }
  return doc.save({ updateFieldAppearances: false })
}
