/**
 * Document properties beyond the standard entries: custom Info keys (ISO 32000 14.3.3) and the fonts a file uses.
 * Fonts are read from the font dictionaries on the pages (PDFium does not report a font's type or subset).
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, type PDFObject } from 'pdf-lib'

export interface CustomProp {
  key: string
  value: string
}

/** Info entries the standard fields of the dialog own. */
export const STANDARD_INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']

const text = (o: unknown): string | null => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : null)

/** A problem with a list of custom properties, or null when it can be written. */
export function checkCustomProps(list: CustomProp[]): string | null {
  const seen = new Set<string>()
  for (const { key } of list) {
    const k = key.trim()
    if (!k) return 'Every custom property needs a name'
    if (k.length > 100) return `"${k.slice(0, 20)}…" is too long a name (100 characters at most)`
    if (STANDARD_INFO_KEYS.some((s) => s.toLowerCase() === k.toLowerCase())) return `"${k}" is one of the standard properties; use its own field`
    if (seen.has(k)) return `"${k}" appears twice`
    seen.add(k)
  }
  return null
}

export async function readCustomProps(bytes: Uint8Array): Promise<CustomProp[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  const out: CustomProp[] = []
  if (!info) return out
  for (const k of info.keys()) {
    const key = k.decodeText()
    if (STANDARD_INFO_KEYS.includes(key)) continue
    const value = text(info.lookup(k))
    if (value !== null) out.push({ key, value })
  }
  return out
}

/** Replaces the custom text entries of the Info dictionary with `list`. Entries of other types are left alone. */
export async function writeCustomProps(bytes: Uint8Array, list: CustomProp[]): Promise<Uint8Array> {
  const problem = checkCustomProps(list)
  if (problem) throw new Error(problem)
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  let info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict)
  if (!info) {
    if (!list.length) return bytes
    const ref = ctx.register(ctx.obj({}))
    ctx.trailerInfo.Info = ref
    info = ctx.lookupMaybe(ref, PDFDict)!
  }
  for (const k of [...info.keys()]) {
    if (!STANDARD_INFO_KEYS.includes(k.decodeText()) && text(info.lookup(k)) !== null) info.delete(k)
  }
  for (const { key, value } of list) info.set(PDFName.of(key.trim()), PDFHexString.fromText(value))
  return doc.save()
}

// ---- Fonts ----------------------------------------------------------------------------------------

export interface FontInfo {
  /** Base font name without any subset prefix. */
  name: string
  /** Type 1, TrueType, Type 0 (CID), Type 3, MMType1 and so on, as a reader would say it. */
  type: string
  encoding: string
  embedded: boolean
  subset: boolean
  /** Pages (from 1) that use it, at most as many as the file has. */
  pages: number[]
}

const SUBSET_PREFIX = /^[A-Z]{6}\+/

const nm = (o: PDFObject | undefined): string => (o instanceof PDFName ? o.decodeText() : '')

const TYPE_LABEL: Record<string, string> = {
  Type1: 'Type 1',
  MMType1: 'Multiple master Type 1',
  TrueType: 'TrueType',
  Type3: 'Type 3',
  Type0: 'Type 0 (composite)',
  CIDFontType0: 'CID Type 0',
  CIDFontType2: 'CID TrueType'
}

function describeFont(font: PDFDict): Omit<FontInfo, 'pages'> {
  const subtype = nm(font.lookup(PDFName.of('Subtype')))
  let name = nm(font.lookup(PDFName.of('BaseFont')))
  let descriptor = font.lookup(PDFName.of('FontDescriptor'))
  let type = TYPE_LABEL[subtype] ?? (subtype || 'Unknown')
  let encoding = ''
  const enc = font.lookup(PDFName.of('Encoding'))
  if (enc instanceof PDFName) encoding = enc.decodeText()
  else if (enc instanceof PDFDict) encoding = nm(enc.lookup(PDFName.of('BaseEncoding'))) || 'Custom'
  if (subtype === 'Type0') {
    const kids = font.lookup(PDFName.of('DescendantFonts'))
    const kid = kids instanceof PDFArray ? kids.lookup(0) : undefined
    if (kid instanceof PDFDict) {
      descriptor = kid.lookup(PDFName.of('FontDescriptor'))
      const sub = nm(kid.lookup(PDFName.of('Subtype')))
      if (sub) type = `${TYPE_LABEL.Type0}, ${TYPE_LABEL[sub] ?? sub}`
      if (!name) name = nm(kid.lookup(PDFName.of('BaseFont')))
    }
  }
  const embedded =
    subtype === 'Type3' ||
    (descriptor instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor instanceof PDFDict && descriptor.lookup(PDFName.of(k)) instanceof PDFStream))
  const subset = SUBSET_PREFIX.test(name)
  return { name: name.replace(SUBSET_PREFIX, '') || '(unnamed)', type, encoding, embedded, subset }
}

/** The fonts a document uses (page resources, form XObjects and annotation appearances), in first-use order. */
export async function listFonts(bytes: Uint8Array): Promise<FontInfo[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const out = new Map<string, FontInfo>()
  const seenRes = new Set<string>()
  const pages = doc.getPages()

  const note = (font: PDFDict, ref: PDFRef | undefined, page: number) => {
    const info = describeFont(font)
    const key = ref ? ref.tag : `${info.name}|${info.type}|${info.embedded}|${info.subset}`
    const known = out.get(key)
    if (known) {
      if (!known.pages.includes(page)) known.pages.push(page)
    } else out.set(key, { ...info, pages: [page] })
  }

  const walk = (resources: PDFObject | undefined, page: number, depth: number) => {
    if (!(resources instanceof PDFDict) || depth > 8) return
    const fonts = resources.lookup(PDFName.of('Font'))
    if (fonts instanceof PDFDict) {
      for (const k of fonts.keys()) {
        const raw = fonts.get(k)
        const f = fonts.lookup(k)
        if (f instanceof PDFDict) note(f, raw instanceof PDFRef ? raw : undefined, page)
      }
    }
    const xobjects = resources.lookup(PDFName.of('XObject'))
    if (xobjects instanceof PDFDict) {
      for (const k of xobjects.keys()) {
        const raw = xobjects.get(k)
        const x = xobjects.lookup(k)
        if (!(x instanceof PDFStream) || nm(x.dict.lookup(PDFName.of('Subtype'))) !== 'Form') continue
        const id = raw instanceof PDFRef ? `${raw.tag}@${page}` : ''
        if (id && seenRes.has(id)) continue
        if (id) seenRes.add(id)
        walk(x.dict.lookup(PDFName.of('Resources')), page, depth + 1)
      }
    }
  }

  pages.forEach((p, i) => {
    // Resources may be inherited from the page tree.
    let node: PDFDict | undefined = p.node
    let res: PDFObject | undefined
    for (let guard = 0; node && guard < 32; guard++) {
      res = node.lookup(PDFName.of('Resources'))
      if (res) break
      const parent: PDFObject | undefined = node.lookup(PDFName.of('Parent'))
      node = parent instanceof PDFDict ? parent : undefined
    }
    walk(res, i + 1, 0)
    const annots = p.node.lookup(PDFName.of('Annots'))
    if (annots instanceof PDFArray) {
      for (let a = 0; a < annots.size(); a++) {
        const annot = annots.lookup(a)
        if (!(annot instanceof PDFDict)) continue
        const ap = annot.lookup(PDFName.of('AP'))
        const normal = ap instanceof PDFDict ? ap.lookup(PDFName.of('N')) : undefined
        if (normal instanceof PDFStream) walk(normal.dict.lookup(PDFName.of('Resources')), i + 1, 1)
      }
    }
  })
  return [...out.values()]
}
