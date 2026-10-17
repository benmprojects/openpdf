/**
 * Editing layers (optional content groups) in the file: rename, add, delete (keeping or removing what is on the
 * layer), merge several layers into one, and flatten (make the layers as they open the permanent look: hidden
 * content is removed, visible content stays, and the layer machinery is taken out). Showing and hiding for the
 * view is in layers.ts; writing the opening state is `withHiddenLayers`.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, type PDFObject } from 'pdf-lib'
import { parseContent, type Op } from './content'
import { contentScopes } from './docStreams'
import { pruneUnreachable } from './redact'

const N = PDFName.of
const keyOf = (r: PDFRef) => `${r.objectNumber} ${r.generationNumber}`

function properties(doc: PDFDocument): PDFDict | undefined {
  return doc.catalog.lookupMaybe(N('OCProperties'), PDFDict)
}

function ocgList(doc: PDFDocument): PDFRef[] {
  const arr = properties(doc)?.lookupMaybe(N('OCGs'), PDFArray)
  const out: PDFRef[] = []
  for (let i = 0; i < (arr?.size() ?? 0); i++) {
    const r = arr!.get(i)
    if (r instanceof PDFRef) out.push(r)
  }
  return out
}

function refKeys(arr: PDFArray | undefined): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < (arr?.size() ?? 0); i++) {
    const r = arr!.get(i)
    if (r instanceof PDFRef) out.add(keyOf(r))
  }
  return out
}

/** Keys of the layers that are off when the document opens. */
function hiddenKeys(doc: PDFDocument): Set<string> {
  const d = properties(doc)?.lookupMaybe(N('D'), PDFDict)
  const all = ocgList(doc).map(keyOf)
  const baseOff = d?.lookup(N('BaseState')) === N('OFF')
  const on = refKeys(d?.lookupMaybe(N('ON'), PDFArray))
  const off = refKeys(d?.lookupMaybe(N('OFF'), PDFArray))
  return new Set(all.filter((k) => (baseOff ? !on.has(k) : off.has(k))))
}

/** Removes references to the given layers from every list in the optional content properties. */
function dropFromProperties(doc: PDFDocument, gone: Set<string>): void {
  const props = properties(doc)
  if (!props) return
  const strip = (arr: PDFArray | undefined): void => {
    if (!arr) return
    for (let i = arr.size() - 1; i >= 0; i--) {
      const v = arr.get(i)
      if (v instanceof PDFRef && gone.has(keyOf(v))) arr.remove(i)
      else if (v instanceof PDFArray) {
        strip(v)
        // A nested group heading with nothing under it stays; an empty list goes.
        if (v.size() === 0) arr.remove(i)
      }
    }
  }
  strip(props.lookupMaybe(N('OCGs'), PDFArray))
  const configs: PDFDict[] = []
  const d = props.lookupMaybe(N('D'), PDFDict)
  if (d) configs.push(d)
  const more = props.lookupMaybe(N('Configs'), PDFArray)
  for (let i = 0; i < (more?.size() ?? 0); i++) {
    const c = more!.lookupMaybe(i, PDFDict)
    if (c) configs.push(c)
  }
  for (const c of configs) for (const k of ['ON', 'OFF', 'Order', 'Locked', 'RBGroups', 'AS']) strip(c.lookupMaybe(N(k), PDFArray))
  for (const c of configs) {
    const rb = c.lookupMaybe(N('RBGroups'), PDFArray)
    if (rb) for (let i = rb.size() - 1; i >= 0; i--) if (rb.lookupMaybe(i, PDFArray)?.size() === 0) rb.remove(i)
  }
}

/** Whether the optional content dictionary (a group or a membership dictionary) is visible given what is hidden. */
function visible(doc: PDFDocument, v: PDFObject | undefined, hidden: Set<string>): boolean {
  if (v instanceof PDFRef) {
    const d = doc.context.lookup(v)
    if (d instanceof PDFDict && d.lookup(N('Type')) === N('OCMD')) return membershipVisible(doc, d, hidden)
    return !hidden.has(keyOf(v))
  }
  if (v instanceof PDFDict && v.lookup(N('Type')) === N('OCMD')) return membershipVisible(doc, v, hidden)
  return true
}

function membershipVisible(doc: PDFDocument, d: PDFDict, hidden: Set<string>): boolean {
  const g = d.get(N('OCGs'))
  const refs: PDFRef[] = []
  if (g instanceof PDFRef && doc.context.lookup(g) instanceof PDFArray) {
    const arr = doc.context.lookup(g) as PDFArray
    for (let i = 0; i < arr.size(); i++) {
      const r = arr.get(i)
      if (r instanceof PDFRef) refs.push(r)
    }
  } else if (g instanceof PDFRef) refs.push(g)
  else if (g instanceof PDFArray) for (let i = 0; i < g.size(); i++) {
    const r = g.get(i)
    if (r instanceof PDFRef) refs.push(r)
  }
  if (!refs.length) return true
  const on = refs.map((r) => !hidden.has(keyOf(r)))
  const p = (d.lookup(N('P')) as PDFName | undefined)?.decodeText() ?? 'AnyOn'
  if (p === 'AllOn') return on.every(Boolean)
  if (p === 'AnyOff') return on.some((x) => !x)
  if (p === 'AllOff') return on.every((x) => !x)
  return on.some(Boolean)
}

type Action = 'keep' | 'unwrap' | 'remove'

/** The groups a /OC value depends on, as keys. */
function groupsOf(doc: PDFDocument, v: PDFObject | undefined): string[] {
  if (v instanceof PDFRef) {
    const d = doc.context.lookup(v)
    if (d instanceof PDFDict && d.lookup(N('Type')) === N('OCMD')) return groupsOf(doc, d)
    return [keyOf(v)]
  }
  if (v instanceof PDFDict) {
    const g = v.get(N('OCGs'))
    const out: string[] = []
    const arr = g instanceof PDFRef ? doc.context.lookup(g) : g
    if (arr instanceof PDFArray) for (let i = 0; i < arr.size(); i++) {
      const r = arr.get(i)
      if (r instanceof PDFRef) out.push(keyOf(r))
    } else if (g instanceof PDFRef) out.push(keyOf(g))
    return out
  }
  return []
}

function applyCuts(src: string, cuts: { start: number; end: number }[]): string {
  const sorted = [...cuts].sort((a, b) => a.start - b.start || b.end - a.end)
  let out = ''
  let at = 0
  for (const c of sorted) {
    if (c.start < at) continue // inside a region already cut
    out += src.slice(at, c.start)
    at = c.end
  }
  return out + src.slice(at)
}

export interface ContentChange {
  removed: number
  unwrapped: number
}

/**
 * Walks every content stream: marked content on a layer is kept, unwrapped (the layer marking is dropped, the content
 * stays) or removed, as `decide` says for the /OC value (a group reference or membership dictionary) it names. Also
 * handles forms and pictures with an /OC entry (drawn with Do), and annotations with one.
 */
function rewriteContent(doc: PDFDocument, decide: (oc: PDFObject) => Action): ContentChange {
  const change: ContentChange = { removed: 0, unwrapped: 0 }
  for (const scope of contentScopes(doc)) {
    const src = scope.get()
    if (!src) continue
    const props = scope.resources?.lookupMaybe(N('Properties'), PDFDict)
    const xo = scope.resources?.lookupMaybe(N('XObject'), PDFDict)
    const ops = parseContent(src)
    const cuts: { start: number; end: number }[] = []
    const stack: { op: Op; action: Action | null }[] = []
    let removedHere = 0
    let unwrappedHere = 0
    for (const op of ops) {
      if (op.op === 'BMC') stack.push({ op, action: null })
      else if (op.op === 'BDC') {
        let action: Action | null = null
        if (op.operands[0]?.t === 'name' && op.operands[0].v === 'OC' && op.operands[1]?.t === 'name') {
          const entry = props?.get(N(op.operands[1].v))
          if (entry) {
            const a = decide(entry)
            if (a !== 'keep') action = a
          }
        }
        stack.push({ op, action })
      } else if (op.op === 'EMC') {
        const top = stack.pop()
        if (!top || !top.action) continue
        if (top.action === 'remove') {
          cuts.push({ start: top.op.start, end: op.end })
          removedHere++
        } else {
          cuts.push({ start: top.op.start, end: top.op.end }, { start: op.start, end: op.end })
          unwrappedHere++
        }
      } else if (op.op === 'Do' && op.operands[0]?.t === 'name' && xo) {
        const x = xo.lookup(N(op.operands[0].v))
        const oc = x instanceof PDFRawStream ? x.dict.get(N('OC')) : undefined
        if (oc && decide(oc) === 'remove') {
          cuts.push({ start: op.start, end: op.end })
          removedHere++
        }
      }
    }
    if (cuts.length) scope.set(applyCuts(src, cuts))
    change.removed += removedHere
    change.unwrapped += unwrappedHere
  }
  // Pictures and forms: the /OC entry itself goes when it was handled; annotations are removed or lose it.
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.has(N('OC'))) {
      const a = decide(obj.dict.get(N('OC'))!)
      if (a !== 'keep') obj.dict.delete(N('OC'))
    }
  }
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
      const a = annots!.lookupMaybe(i, PDFDict)
      const oc = a?.get(N('OC'))
      if (!a || !oc) continue
      const act = decide(oc)
      if (act === 'remove') {
        annots!.remove(i)
        change.removed++
      } else if (act === 'unwrap') {
        a.delete(N('OC'))
        change.unwrapped++
      }
    }
  }
  return change
}

/** Replaces references to layers listed in `map` throughout the file (values of dictionaries and array items), except in the optional content properties. */
function redirectRefs(doc: PDFDocument, map: Map<string, PDFRef>): number {
  let n = 0
  const props = properties(doc)
  const seen = new Set<PDFObject>()
  const visit = (o: PDFObject | undefined): void => {
    if (!o || seen.has(o)) return
    seen.add(o)
    const dict = o instanceof PDFRawStream ? o.dict : o instanceof PDFDict ? o : null
    if (dict) {
      if (dict === props) return
      for (const [k, v] of dict.entries()) {
        if (v instanceof PDFRef) {
          const to = map.get(keyOf(v))
          if (to) {
            dict.set(k, to)
            n++
          }
        } else visit(v)
      }
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) {
        const v = o.get(i)
        if (v instanceof PDFRef) {
          const to = map.get(keyOf(v))
          if (to) {
            o.set(i, to)
            n++
          }
        } else visit(v)
      }
    }
  }
  for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj)
  visit(doc.catalog)
  return n
}

/** Renames a layer. */
export async function renameLayer(bytes: Uint8Array, key: string, name: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ref = ocgList(doc).find((r) => keyOf(r) === key)
  const dict = ref ? doc.context.lookupMaybe(ref, PDFDict) : undefined
  if (!dict) throw new Error('That layer is no longer in the document.')
  dict.set(N('Name'), PDFHexString.fromText(name))
  return doc.save()
}

/** Adds an empty layer, visible by default. Returns the new file and the layer's key. */
export async function addLayer(bytes: Uint8Array, name: string): Promise<{ bytes: Uint8Array; key: string }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText(name) }))
  let props = properties(doc)
  if (!props) {
    props = ctx.obj({ OCGs: [], D: {} }) as PDFDict
    doc.catalog.set(N('OCProperties'), props)
  }
  let ocgs = props.lookupMaybe(N('OCGs'), PDFArray)
  if (!ocgs) {
    ocgs = ctx.obj([]) as PDFArray
    props.set(N('OCGs'), ocgs)
  }
  ocgs.push(ref)
  let d = props.lookupMaybe(N('D'), PDFDict)
  if (!d) {
    d = ctx.obj({}) as PDFDict
    props.set(N('D'), d)
  }
  const order = d.lookupMaybe(N('Order'), PDFArray)
  if (order) order.push(ref)
  const on = d.lookupMaybe(N('ON'), PDFArray)
  if (on) on.push(ref)
  return { bytes: await doc.save(), key: keyOf(ref) }
}

/** Deletes a layer. `content` says what happens to what is on it: it stays (visible, no longer on a layer) or is removed. */
export async function deleteLayer(bytes: Uint8Array, key: string, content: 'keep' | 'remove'): Promise<{ bytes: Uint8Array; change: ContentChange }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  if (!ocgList(doc).some((r) => keyOf(r) === key)) throw new Error('That layer is no longer in the document.')
  const change = rewriteContent(doc, (oc) => {
    const groups = groupsOf(doc, oc)
    // A membership of several layers is only dropped with its last one; one layer on its own is the case that matters.
    if (groups.length === 1 && groups[0] === key) return content === 'keep' ? 'unwrap' : 'remove'
    return 'keep'
  })
  dropFromProperties(doc, new Set([key]))
  pruneUnreachable(doc)
  return { bytes: await doc.save(), change }
}

/** Merges the layers `keys` into `target`: everything on them is then on `target`, and they are removed. */
export async function mergeLayers(bytes: Uint8Array, keys: string[], target: string): Promise<{ bytes: Uint8Array; merged: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const list = ocgList(doc)
  const to = list.find((r) => keyOf(r) === target)
  if (!to) throw new Error('The layer to merge into is no longer in the document.')
  const map = new Map<string, PDFRef>()
  for (const k of keys) if (k !== target && list.some((r) => keyOf(r) === k)) map.set(k, to)
  if (!map.size) return { bytes, merged: 0 }
  redirectRefs(doc, map)
  dropFromProperties(doc, new Set(map.keys()))
  pruneUnreachable(doc)
  return { bytes: await doc.save(), merged: map.size }
}

/** Makes the layers as they open the permanent look: hidden content is removed and the layer structure is taken out. */
export async function flattenLayers(bytes: Uint8Array): Promise<{ bytes: Uint8Array; change: ContentChange; layers: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const layers = ocgList(doc).length
  if (!properties(doc)) return { bytes, change: { removed: 0, unwrapped: 0 }, layers: 0 }
  const hidden = hiddenKeys(doc)
  const change = rewriteContent(doc, (oc) => (visible(doc, oc, hidden) ? 'unwrap' : 'remove'))
  doc.catalog.delete(N('OCProperties'))
  pruneUnreachable(doc)
  return { bytes: await doc.save(), change, layers }
}
