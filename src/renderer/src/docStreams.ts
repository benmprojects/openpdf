/**
 * Walks every place a document keeps drawing instructions: page contents, form XObjects (also reached through
 * annotation appearances), and tiling patterns. Each place is a "scope" with its resources and a way to read and
 * replace its instructions as a Latin-1 string (see content.ts). Shared by the tools that rewrite colours, fonts and
 * layers across a whole document.
 */
import { PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, type PDFDocument, type PDFObject, type PDFPage } from 'pdf-lib'
import { bytesToString, stringToBytes } from './content'
import { pageContent, setPageContent } from './pageContent'

const N = PDFName.of

export interface Scope {
  kind: 'page' | 'form' | 'pattern'
  /** Zero-based page for a page scope. */
  page?: number
  resources: PDFDict | undefined
  /** The stream dictionary of a form or pattern. */
  dict?: PDFDict
  get(): string
  set(src: string): void
}

/** A page's resources, looking up the page tree for inherited ones. */
export function pageResources(page: PDFPage): PDFDict | undefined {
  let node: PDFDict | undefined = page.node
  for (let i = 0; node && i < 32; i++) {
    const res = node.lookupMaybe(N('Resources'), PDFDict)
    if (res) return res
    node = node.lookupMaybe(N('Parent'), PDFDict)
  }
  return undefined
}

/** Replaces a stream's data (compressed), keeping its other dictionary entries. */
export function replaceStreamData(doc: PDFDocument, ref: PDFRef, old: PDFRawStream, data: Uint8Array): void {
  const ctx = doc.context
  const fresh = ctx.flateStream(data)
  for (const [k, v] of old.dict.entries()) {
    const key = k.decodeText()
    if (key === 'Filter' || key === 'DecodeParms' || key === 'Length' || key === 'DL') continue
    fresh.dict.set(k, v)
  }
  ctx.assign(ref, fresh)
}

/** Every drawing-instruction scope in the document. Streams shared by several pages are listed once. */
export function contentScopes(doc: PDFDocument): Scope[] {
  const out: Scope[] = []
  const seen = new Set<PDFRef>()
  const addStream = (ref: PDFRef, kind: 'form' | 'pattern'): void => {
    if (seen.has(ref)) return
    seen.add(ref)
    const st = doc.context.lookup(ref)
    if (!(st instanceof PDFRawStream)) return
    const resources = st.dict.lookupMaybe(N('Resources'), PDFDict)
    out.push({
      kind,
      resources,
      dict: st.dict,
      get: () => {
        try {
          return bytesToString(decodePDFRawStream(st).decode())
        } catch {
          return ''
        }
      },
      set: (src) => replaceStreamData(doc, ref, st, stringToBytes(src))
    })
    visitResources(resources, 0)
  }
  const visitResources = (res: PDFDict | undefined, depth: number): void => {
    if (!res || depth > 8) return
    const xo = res.lookupMaybe(N('XObject'), PDFDict)
    for (const [, v] of xo?.entries() ?? []) {
      if (!(v instanceof PDFRef)) continue
      const st = doc.context.lookup(v)
      if (st instanceof PDFRawStream && st.dict.lookup(N('Subtype')) === N('Form')) addStream(v, 'form')
    }
    const pat = res.lookupMaybe(N('Pattern'), PDFDict)
    for (const [, v] of pat?.entries() ?? []) {
      if (!(v instanceof PDFRef)) continue
      const st = doc.context.lookup(v)
      if (st instanceof PDFRawStream && st.dict.lookup(N('PatternType'))?.toString() === '1') addStream(v, 'pattern')
    }
  }
  doc.getPages().forEach((page, i) => {
    const res = pageResources(page)
    out.push({ kind: 'page', page: i, resources: res, get: () => pageContent(page), set: (src) => setPageContent(doc, page, src) })
    visitResources(res, 0)
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const a = annots!.lookupMaybe(k, PDFDict)
      const ap = a?.lookupMaybe(N('AP'), PDFDict)
      if (!ap) continue
      for (const key of ['N', 'D', 'R']) {
        const entry: PDFObject | undefined = ap.get(N(key))
        const refs: PDFRef[] = []
        if (entry instanceof PDFRef) {
          const target = doc.context.lookup(entry)
          if (target instanceof PDFRawStream) refs.push(entry)
          else if (target instanceof PDFDict) for (const [, v] of target.entries()) if (v instanceof PDFRef) refs.push(v)
        } else if (entry instanceof PDFDict) for (const [, v] of entry.entries()) if (v instanceof PDFRef) refs.push(v)
        for (const r of refs) addStream(r, 'form')
      }
    }
  })
  return out
}

/** Every image XObject reachable from the pages' resources (through forms), once each. */
export function imageStreams(doc: PDFDocument): { ref: PDFRef; stream: PDFRawStream }[] {
  const out: { ref: PDFRef; stream: PDFRawStream }[] = []
  const seen = new Set<PDFRef>()
  for (const scope of contentScopes(doc)) {
    const xo = scope.resources?.lookupMaybe(N('XObject'), PDFDict)
    for (const [, v] of xo?.entries() ?? []) {
      if (!(v instanceof PDFRef) || seen.has(v)) continue
      const st = doc.context.lookup(v)
      if (st instanceof PDFRawStream && st.dict.lookup(N('Subtype')) === N('Image')) {
        seen.add(v)
        out.push({ ref: v, stream: st })
      }
    }
  }
  return out
}
