/**
 * Layers (optional content groups). PDFium's public API cannot list or switch them, so they are read with
 * pdf-lib, and a view with some layers switched off is made by rewriting the default configuration
 * (/OCProperties /D) in a copy that only the viewer loads. The file itself is never changed.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, PDFHexString } from 'pdf-lib'

export interface Layer {
  /** Object reference, "num gen". Stable across loads of the same bytes. */
  key: string
  name: string
  /** Visible when the document opens. */
  defaultOn: boolean
}

const keyOf = (r: PDFRef) => `${r.objectNumber} ${r.generationNumber}`

function ocProperties(doc: PDFDocument): { ocgs: PDFRef[]; d: PDFDict | undefined } | null {
  const props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)
  if (!props) return null
  const arr = props.lookupMaybe(PDFName.of('OCGs'), PDFArray)
  const ocgs: PDFRef[] = []
  for (let i = 0; i < (arr?.size() ?? 0); i++) {
    const r = arr!.get(i)
    if (r instanceof PDFRef) ocgs.push(r)
  }
  return { ocgs, d: props.lookupMaybe(PDFName.of('D'), PDFDict) }
}

function refKeys(d: PDFDict | undefined, name: string): Set<string> {
  const arr = d?.lookupMaybe(PDFName.of(name), PDFArray)
  const out = new Set<string>()
  for (let i = 0; i < (arr?.size() ?? 0); i++) {
    const r = arr!.get(i)
    if (r instanceof PDFRef) out.add(keyOf(r))
  }
  return out
}

/** The document's layers, in /OCGs order. Empty for documents without optional content or that cannot be read. */
export async function readLayers(bytes: Uint8Array): Promise<Layer[]> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch {
    return []
  }
  const oc = ocProperties(doc)
  if (!oc) return []
  const baseOff = oc.d?.lookupMaybe(PDFName.of('BaseState'), PDFName)?.asString() === '/OFF'
  const on = refKeys(oc.d, 'ON')
  const off = refKeys(oc.d, 'OFF')
  return oc.ocgs.map((ref) => {
    const dict = doc.context.lookupMaybe(ref, PDFDict)
    const n = dict?.lookup(PDFName.of('Name'))
    const name = n instanceof PDFString || n instanceof PDFHexString ? n.decodeText() : `Layer ${ref.objectNumber}`
    const key = keyOf(ref)
    return { key, name, defaultOn: baseOff ? on.has(key) : !off.has(key) }
  })
}

/** A copy of `bytes` whose default view shows exactly the layers not in `hidden`. */
export async function withHiddenLayers(bytes: Uint8Array, hidden: ReadonlySet<string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const oc = ocProperties(doc)
  if (!oc) return bytes
  const props = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict)
  const d = oc.d ?? doc.context.obj({})
  const on = oc.ocgs.filter((r) => !hidden.has(keyOf(r)))
  const off = oc.ocgs.filter((r) => hidden.has(keyOf(r)))
  d.set(PDFName.of('BaseState'), PDFName.of('ON'))
  d.set(PDFName.of('ON'), doc.context.obj(on))
  d.set(PDFName.of('OFF'), doc.context.obj(off))
  // Usage-based automatic switching (AS) could override the choice; the viewer copy drops it.
  d.delete(PDFName.of('AS'))
  props.set(PDFName.of('D'), d)
  return doc.save({ useObjectStreams: false })
}
