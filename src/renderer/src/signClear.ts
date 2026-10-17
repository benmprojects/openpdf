/**
 * Clear all signatures: empties every signature field (the signature itself is removed, the field stays so the document
 * can be signed again), takes off the certification and usage-rights signature, and can keep how the signatures looked
 * as ordinary page content. This rewrites the whole file, so earlier signatures cannot survive it: the point is that
 * they are gone, not broken.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFPage } from 'pdf-lib'
import { appearanceMatrix } from './flatten'

const N = PDFName.of

const nums = (a: PDFArray | undefined, n: number): number[] | null => {
  if (!a || a.size() < n) return null
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const v = a.lookupMaybe(i, PDFNumber)
    if (!v) return null
    out.push(v.asNumber())
  }
  return out
}

interface SigField {
  dict: PDFDict
  /** The array it sits in (the form's /Fields or a parent's /Kids). */
  owner: PDFArray
  index: number
  signed: boolean
}

/** Every signature field, whether signed or not. */
function signatureFields(doc: PDFDocument): SigField[] {
  const out: SigField[] = []
  const seen = new Set<PDFDict>()
  const walk = (arr: PDFArray | undefined, inheritedType: string) => {
    if (!arr) return
    for (let i = 0; i < arr.size(); i++) {
      const f = arr.lookupMaybe(i, PDFDict)
      if (!f || seen.has(f)) continue
      seen.add(f)
      const ft = f.lookupMaybe(N('FT'), PDFName)?.decodeText() ?? inheritedType
      const kids = f.lookupMaybe(N('Kids'), PDFArray)
      if (ft === 'Sig') out.push({ dict: f, owner: arr, index: i, signed: f.lookupMaybe(N('V'), PDFDict) !== undefined })
      walk(kids, ft)
    }
  }
  walk(doc.catalog.lookupMaybe(N('AcroForm'), PDFDict)?.lookupMaybe(N('Fields'), PDFArray), '')
  return out
}

/** The widgets of a field: the field itself when it is one, and its kids that are. */
function widgetsOf(f: PDFDict): PDFDict[] {
  const out: PDFDict[] = []
  if (f.lookup(N('Subtype')) === N('Widget')) out.push(f)
  const kids = f.lookupMaybe(N('Kids'), PDFArray)
  for (let i = 0; kids && i < kids.size(); i++) {
    const k = kids.lookupMaybe(i, PDFDict)
    if (k?.lookup(N('Subtype')) === N('Widget')) out.push(k)
  }
  return out
}

function pageOfWidget(doc: PDFDocument, w: PDFDict): PDFPage | undefined {
  const p = w.get(N('P'))
  const byRef = p instanceof PDFRef ? doc.getPages().find((pg) => pg.ref === p) : undefined
  if (byRef) return byRef
  return doc.getPages().find((pg) => {
    const annots = pg.node.lookupMaybe(N('Annots'), PDFArray)
    return !!annots && annots.asArray().some((r) => doc.context.lookup(r) === w)
  })
}

/** The appearance a widget shows, with its box, when it has a visible one. */
function visibleLook(doc: PDFDocument, w: PDFDict): { ref: PDFRef; stream: PDFStream; rect: number[] } | undefined {
  const rect = nums(w.lookupMaybe(N('Rect'), PDFArray), 4)
  if (!rect || Math.abs(rect[2] - rect[0]) < 1 || Math.abs(rect[3] - rect[1]) < 1) return undefined
  const n = w.lookupMaybe(N('AP'), PDFDict)?.get(N('N'))
  const stream = n instanceof PDFRef ? doc.context.lookup(n) : undefined
  return n instanceof PDFRef && stream instanceof PDFStream ? { ref: n, stream, rect } : undefined
}

/** How many signed fields have an appearance that shows on the page. */
export async function visibleSignatureCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  return signatureFields(doc).filter((f) => f.signed && widgetsOf(f.dict).some((w) => visibleLook(doc, w))).length
}

export async function clearSignatures(bytes: Uint8Array, keepLook: boolean): Promise<{ bytes: Uint8Array; cleared: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const fields = signatureFields(doc)
  const signed = fields.filter((f) => f.signed)
  const perms = doc.catalog.lookupMaybe(N('Perms'), PDFDict)
  const hadPerms = !!(perms?.has(N('DocMDP')) || perms?.has(N('UR3')))
  if (!signed.length && !hadPerms) return { bytes, cleared: 0 }

  // Pick out what to remove first: removing shifts the indices.
  const drop: SigField[] = []
  /** The signature objects themselves: removed from the file, so that the cleared signatures are not still in it (unseen). */
  const orphans: PDFRef[] = []
  for (const f of signed) {
    const v = f.dict.get(N('V'))
    if (v instanceof PDFRef) orphans.push(v)
    const widgets = widgetsOf(f.dict)
    if (keepLook) {
      for (const w of widgets) {
        const look = visibleLook(doc, w)
        const page = pageOfWidget(doc, w)
        if (!look || !page) continue
        const bbox = nums(look.stream.dict.lookupMaybe(N('BBox'), PDFArray), 4) ?? [0, 0, 1, 1]
        const matrix = nums(look.stream.dict.lookupMaybe(N('Matrix'), PDFArray), 6) ?? [1, 0, 0, 1, 0, 0]
        const m = appearanceMatrix(bbox, matrix, look.rect)
        const key = page.node.newXObject('FlatSig', look.ref)
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(key), popGraphicsState())
      }
      drop.push(f)
    } else {
      f.dict.delete(N('V'))
      for (const w of widgets) {
        w.delete(N('AP'))
        w.delete(N('AS'))
      }
    }
  }

  if (keepLook) {
    // The field and its widgets go: what they looked like is now page content.
    const widgets = new Set(drop.flatMap((f) => widgetsOf(f.dict)))
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
      for (let i = (annots?.size() ?? 0) - 1; annots && i >= 0; i--) if (widgets.has(annots.lookup(i) as PDFDict)) annots.remove(i)
    }
    // Remove from the owners from the back so the indices stay right.
    for (const f of [...drop].sort((a, b) => b.index - a.index)) {
      if (f.owner.lookup(f.index) === f.dict) f.owner.remove(f.index)
    }
  }

  const permsSig = (key: string) => {
    const r = perms?.get(N(key))
    if (r instanceof PDFRef) orphans.push(r)
  }
  permsSig('DocMDP')
  permsSig('UR3')
  perms?.delete(N('DocMDP'))
  perms?.delete(N('UR3'))
  for (const ref of new Set(orphans)) doc.context.delete(ref)
  if (perms && !perms.keys().length) doc.catalog.delete(N('Perms'))
  const form = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict)
  form?.delete(N('SigFlags'))
  return { bytes: await doc.save({ updateFieldAppearances: false }), cleared: signed.length }
}
