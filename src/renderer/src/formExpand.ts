/**
 * Makes what is inside form XObjects editable: a form drawn with `Do` is replaced, in the page's content, by its own
 * instructions (inside `q ... Q`, under the form's matrix and clipped to its box), and its fonts, pictures, graphics
 * states and other resources are added to the page's resources (renamed when a name is already taken by something
 * else). PDFium lists text, pictures and shapes only at page level, so after this the Edit text, Edit image, Edit shape
 * tools and the Content pane can reach them. Forms with a layer (/OC) are left alone. A form's transparency group is
 * dropped by inlining (blending inside the group then blends with the page).
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFObject, type PDFPage } from 'pdf-lib'
import { bytesToString, num, parseContent, type Op } from './content'
import { pageResources } from './docStreams'
import { setPageContent, pageContent } from './pageContent'

const N = PDFName.of

const CATEGORIES = ['Font', 'XObject', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'Properties'] as const
type Category = (typeof CATEGORIES)[number]

export interface ExpandResult {
  bytes: Uint8Array
  /** Forms replaced by their content. */
  expanded: number
  /** Forms left as they are, with the reason. */
  skipped: { reason: string; count: number }[]
  /** Pages (zero-based) that changed. */
  pages: number[]
}

/** The category a name operand belongs to, for operators whose operand is a resource name; null when the operator names none. */
function nameSlot(o: Op): { category: Category; at: number } | null {
  const first = o.operands[0]
  switch (o.op) {
    case 'Tf':
      return first?.t === 'name' ? { category: 'Font', at: 0 } : null
    case 'Do':
      return first?.t === 'name' ? { category: 'XObject', at: 0 } : null
    case 'gs':
      return first?.t === 'name' ? { category: 'ExtGState', at: 0 } : null
    case 'cs':
    case 'CS':
      return first?.t === 'name' && !/^(Device|Pattern)/.test(first.v) && !['G', 'RGB', 'CMYK', 'I'].includes(first.v) ? { category: 'ColorSpace', at: 0 } : null
    case 'scn':
    case 'SCN': {
      const last = o.operands[o.operands.length - 1]
      return last?.t === 'name' ? { category: 'Pattern', at: o.operands.length - 1 } : null
    }
    case 'sh':
      return first?.t === 'name' ? { category: 'Shading', at: 0 } : null
    case 'BDC':
    case 'DP':
      return o.operands[1]?.t === 'name' ? { category: 'Properties', at: 1 } : null
    default:
      return null
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Content with resource names changed as `renames` says (per category). */
export function renameResources(src: string, renames: Map<string, string>): string {
  if (!renames.size) return src
  const ops = parseContent(src)
  let out = ''
  let at = 0
  for (const o of ops) {
    const slot = nameSlot(o)
    if (!slot) continue
    const tok = o.operands[slot.at]
    if (tok.t !== 'name') continue
    const to = renames.get(`${slot.category}/${tok.v}`)
    if (!to) continue
    const slice = src.slice(o.start, o.end)
    const re = new RegExp(`/${escapeRe(tok.v)}(?![^\\s/\\[\\]<>()%])`)
    const m = re.exec(slice)
    if (!m) continue
    out += src.slice(at, o.start + m.index) + `/${to}`
    at = o.start + m.index + m[0].length
  }
  return out + src.slice(at)
}

/** Makes the page's own resource dictionary (a copy of an inherited one) so it can be added to. */
function ownResources(doc: PDFDocument, page: PDFPage): PDFDict {
  const own = page.node.lookupMaybe(N('Resources'), PDFDict)
  if (own) return own
  const inherited = pageResources(page)
  const made = inherited ? inherited.clone(doc.context) : (doc.context.obj({}) as PDFDict)
  page.node.set(N('Resources'), made)
  return made
}

const sameObject = (a: PDFObject | undefined, b: PDFObject | undefined): boolean => a !== undefined && b !== undefined && (a === b || (a instanceof PDFRef && b instanceof PDFRef && a.objectNumber === b.objectNumber))

/**
 * Adds the form's resources to the page's. Returns the renames (category/oldName to newName) for names that were
 * already used on the page by something else.
 */
function mergeResources(doc: PDFDocument, page: PDFPage, formRes: PDFDict): Map<string, string> {
  const renames = new Map<string, string>()
  const res = ownResources(doc, page)
  for (const cat of CATEGORIES) {
    const from = formRes.lookupMaybe(N(cat), PDFDict)
    if (!from) continue
    let into = res.lookupMaybe(N(cat), PDFDict)
    if (!into) {
      into = doc.context.obj({}) as PDFDict
      res.set(N(cat), into)
    }
    for (const [key, value] of from.entries()) {
      const name = key.decodeText()
      const there = into.get(key)
      if (there === undefined) {
        into.set(key, value)
        continue
      }
      if (sameObject(there, value)) continue
      let k = 1
      while (into.has(N(`${name}x${k}`))) k++
      into.set(N(`${name}x${k}`), value)
      renames.set(`${cat}/${name}`, `${name}x${k}`)
    }
  }
  return renames
}

const numbers = (arr: PDFArray | undefined, n: number): number[] | null => {
  if (!arr || arr.size() < n) return null
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const v = arr.lookup(i)
    if (!(v instanceof PDFNumber)) return null
    out.push(v.asNumber())
  }
  return out
}

/** Replaces the forms drawn by the given pages (all pages when omitted) with their content. Nested forms are unpacked too (up to four levels). */
export async function expandForms(bytes: Uint8Array, o: { pages?: number[] } = {}): Promise<ExpandResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const skipped = new Map<string, number>()
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
  let expanded = 0
  const changed: number[] = []
  const want = o.pages ? new Set(o.pages) : null
  const pages = doc.getPages()
  for (let p = 0; p < pages.length; p++) {
    if (want && !want.has(p)) continue
    const page = pages[p]
    let did = false
    for (let pass = 0; pass < 4; pass++) {
      const src = pageContent(page)
      const ops = parseContent(src)
      const xo = pageResources(page)?.lookupMaybe(N('XObject'), PDFDict)
      const edits: { op: Op; text: string }[] = []
      for (const op of ops) {
        if (op.op !== 'Do' || op.operands[0]?.t !== 'name' || !xo) continue
        const form = xo.lookup(N(op.operands[0].v))
        if (!(form instanceof PDFRawStream) || form.dict.lookup(N('Subtype')) !== N('Form')) continue
        if (form.dict.has(N('OC'))) {
          skip('The form is on a layer')
          continue
        }
        let content: string
        try {
          content = bytesToString(decodePDFRawStream(form).decode())
        } catch {
          skip('The form could not be read')
          continue
        }
        const m = numbers(form.dict.lookupMaybe(N('Matrix'), PDFArray), 6) ?? [1, 0, 0, 1, 0, 0]
        const box = numbers(form.dict.lookupMaybe(N('BBox'), PDFArray), 4)
        const res = form.dict.lookupMaybe(N('Resources'), PDFDict)
        const renames = res ? mergeResources(doc, page, res) : new Map<string, string>()
        const clip = box ? `${num(Math.min(box[0], box[2]))} ${num(Math.min(box[1], box[3]))} ${num(Math.abs(box[2] - box[0]))} ${num(Math.abs(box[3] - box[1]))} re W n ` : ''
        edits.push({ op, text: `q ${m.map(num).join(' ')} cm ${clip}${renameResources(content, renames)}\nQ` })
      }
      if (!edits.length) break
      let out = ''
      let at = 0
      for (const e of edits) {
        out += src.slice(at, e.op.start) + e.text
        at = e.op.end
      }
      setPageContent(doc, page, out + src.slice(at))
      expanded += edits.length
      did = true
    }
    if (did) changed.push(p)
  }
  return { bytes: expanded ? await doc.save() : bytes, expanded, skipped: [...skipped].map(([reason, count]) => ({ reason, count })), pages: changed }
}
