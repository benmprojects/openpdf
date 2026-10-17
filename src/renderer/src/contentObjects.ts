/**
 * The objects a page draws itself (text runs, pictures, painted paths and forms), in drawing order, read from its
 * content stream; and the edits that work on that order: hiding, showing and moving an object one place forward or
 * back. Everything here works on the stream's text and operations; nothing needs a PDF library.
 *
 * Hiding wraps an object in marked content that points at an optional content group (`/OC /OPHide... BDC ... EMC`);
 * the document layer switches that group off. Moving an object past its neighbour takes its operators out and puts
 * them after the neighbour, in `q ... Q` with whatever graphics state they relied on written out again, and refuses
 * when that state cannot be rebuilt (a different clip, different transparency settings or marked content).
 */
import { cmOp, imageDraws, isShow, matInverse, matMul, parseContent, pathDraws, showBytes, type Matrix6, type Op } from './content'

export type ObjectKind = 'text' | 'image' | 'path' | 'form'

export const HIDE_PREFIX = 'OPHide'

export interface StreamObject {
  kind: ObjectKind
  /** Position among the objects of its kind: the same count PDFium's object lists use. */
  typeOrdinal: number
  /** First and last operation of the object (inclusive). */
  first: number
  last: number
  /** Everything that moves with it: the whole text object around a text run, and a hiding wrapper. */
  group: { first: number; last: number }
  /** The resource name of the hiding group when the object is hidden. */
  hiddenBy: string | null
  /** Why the object cannot be moved in the drawing order, or null. */
  fixed: string | null
}

const isOc = (o: Op | undefined): string | null => {
  if (!o || o.op !== 'BDC') return null
  const [tag, props] = o.operands
  return tag?.t === 'name' && tag.v === 'OC' && props?.t === 'name' && props.v.startsWith(HIDE_PREFIX) ? props.v : null
}

/** Lists the objects of a content stream in drawing order. `isImage` and `isForm` say what a named XObject is. */
export function listObjects(ops: Op[], isImage: (name: string) => boolean, isForm: (name: string) => boolean): StreamObject[] {
  const found: StreamObject[] = []
  const hidden = (first: number, last: number) => (isOc(ops[first - 1]) && ops[last + 1]?.op === 'EMC' ? isOc(ops[first - 1]) : null)

  let t = 0
  ops.forEach((o, i) => {
    if (!isShow(o) || showBytes(o).length === 0) return
    // The text object around it: nearest BT before and ET after.
    let bt = i
    while (bt >= 0 && ops[bt].op !== 'BT') bt--
    let et = i
    while (et < ops.length && ops[et].op !== 'ET') et++
    const inside = bt >= 0 && et < ops.length
    let shows = 0
    if (inside) for (let k = bt; k <= et; k++) if (isShow(ops[k]) && showBytes(ops[k]).length > 0) shows++
    found.push({
      kind: 'text',
      typeOrdinal: t++,
      first: i,
      last: i,
      group: inside ? { first: bt, last: et } : { first: i, last: i },
      hiddenBy: hidden(i, i),
      fixed: !inside ? 'This text is not inside a text object.' : shows > 1 ? 'This text shares a text object with other text.' : null
    })
  })

  let im = 0
  for (const d of imageDraws(ops, isImage)) {
    const h = hidden(d.index, d.index)
    found.push({ kind: 'image', typeOrdinal: im++, first: d.index, last: d.index, group: h ? { first: d.index - 1, last: d.index + 1 } : { first: d.index, last: d.index }, hiddenBy: h, fixed: null })
  }

  let p = 0
  for (const d of pathDraws(ops)) {
    const h = hidden(d.first, d.paint)
    found.push({ kind: 'path', typeOrdinal: p++, first: d.first, last: d.paint, group: h ? { first: d.first - 1, last: d.paint + 1 } : { first: d.first, last: d.paint }, hiddenBy: h, fixed: d.clips ? 'This shape also sets a clipping area.' : null })
  }

  let f = 0
  ops.forEach((o, i) => {
    if (o.op !== 'Do') return
    const n = o.operands[0]
    if (!n || n.t !== 'name' || !isForm(n.v)) return
    const h = hidden(i, i)
    found.push({ kind: 'form', typeOrdinal: f++, first: i, last: i, group: h ? { first: i - 1, last: i + 1 } : { first: i, last: i }, hiddenBy: h, fixed: null })
  })

  return found.sort((a, b) => a.last - b.last)
}

// ---- Graphics state ---------------------------------------------------------------------------------------

interface GState {
  ctm: Matrix6
  /** The operators in force for each setting, as written. */
  cats: Record<string, string[]>
  gs: string[]
  clip: string[]
}

const FILL = new Set(['g', 'rg', 'k', 'cs', 'sc', 'scn'])
const STROKE = new Set(['G', 'RG', 'K', 'CS', 'SC', 'SCN'])
const SINGLE = new Set(['w', 'J', 'j', 'M', 'd', 'Tc', 'Tw', 'Tz', 'TL', 'Tf', 'Tr', 'Ts'])
const DEFAULTS: Record<string, string> = { fill: '0 g', stroke: '0 G', w: '1 w', J: '0 J', j: '0 j', M: '10 M', d: '[] 0 d', Tc: '0 Tc', Tw: '0 Tw', Tz: '100 Tz', TL: '0 TL', Tr: '0 Tr', Ts: '0 Ts' }
const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'])

const clone = (s: GState): GState => ({ ctm: s.ctm, cats: Object.fromEntries(Object.entries(s.cats).map(([k, v]) => [k, [...v]])), gs: [...s.gs], clip: [...s.clip] })

/** The graphics state and the open marked content just before operation `index`. */
export function stateBefore(src: string, ops: Op[], index: number): { state: GState; marked: string[] } {
  let st: GState = { ctm: [1, 0, 0, 1, 0, 0], cats: {}, gs: [], clip: [] }
  const stack: GState[] = []
  const marked: string[] = []
  let pending = false
  for (let i = 0; i < index && i < ops.length; i++) {
    const o = ops[i]
    const text = src.slice(o.start, o.end)
    if (o.op === 'q') stack.push(clone(st))
    else if (o.op === 'Q') st = stack.pop() ?? st
    else if (o.op === 'cm') {
      const n = o.operands.filter((x) => x.t === 'num').map((x) => (x as { v: number }).v)
      if (n.length === 6) st.ctm = matMul(n as Matrix6, st.ctm)
    } else if (FILL.has(o.op) || STROKE.has(o.op)) {
      const key = FILL.has(o.op) ? 'fill' : 'stroke'
      const isSet = o.op === 'sc' || o.op === 'scn' || o.op === 'SC' || o.op === 'SCN'
      const head = st.cats[key]?.[0]
      st.cats[key] = isSet && head && /\b(cs|CS)$/.test(head) ? [head, text] : [text]
    } else if (SINGLE.has(o.op)) st.cats[o.op] = [text]
    else if (o.op === 'gs') st.gs.push(text)
    else if (o.op === 'W' || o.op === 'W*') pending = true
    else if (PAINT.has(o.op)) {
      if (pending) st.clip.push(`#${i}`)
      pending = false
    } else if (o.op === 'BDC' || o.op === 'BMC') marked.push(text)
    else if (o.op === 'EMC') marked.pop()
  }
  return { state: st, marked }
}

const same = (a: string[] | undefined, b: string[] | undefined) => (a ?? []).join('\n') === (b ?? []).join('\n')

/**
 * The operators that make drawing at `to` look as it did at `from`, or a message when that cannot be rebuilt. The
 * clip, the transparency settings and the open marked content have to match already.
 */
export function bridgeState(from: { state: GState; marked: string[] }, to: { state: GState; marked: string[] }): { ops: string } | { problem: string } {
  if (!same(from.state.clip, to.state.clip)) return { problem: 'These objects are clipped differently, so their order cannot be changed safely.' }
  if (!same(from.state.gs, to.state.gs)) return { problem: 'These objects use different transparency or blend settings, so their order cannot be changed safely.' }
  if (!same(from.marked, to.marked)) return { problem: 'These objects belong to different layers or tagged content, so their order cannot be changed safely.' }
  let ops = ''
  const inv = matInverse(to.state.ctm)
  if (!inv) return { problem: 'The drawing area at the new place has no size, so the order cannot be changed.' }
  const rel = matMul(from.state.ctm, inv)
  if (rel.some((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) > 1e-9)) ops += `${cmOp(rel)} `
  for (const key of new Set([...Object.keys(from.state.cats), ...Object.keys(to.state.cats)])) {
    if (same(from.state.cats[key], to.state.cats[key])) continue
    const want = from.state.cats[key]
    if (want) ops += `${want.join(' ')} `
    else if (DEFAULTS[key]) ops += `${DEFAULTS[key]} `
  }
  return { ops }
}

/** The stream with object `a` moved to just after object `b` (which must come later in drawing order). */
export function moveAfter(src: string, ops: Op[], a: StreamObject, b: StreamObject): { src: string } | { problem: string } {
  if (a.fixed) return { problem: a.fixed + ' Its order cannot be changed.' }
  if (b.fixed && b.kind === 'text') return { problem: b.fixed + ' Its order cannot be changed.' }
  if (a.group.last >= b.group.first) return { problem: 'These two objects overlap in the page content, so their order cannot be changed.' }
  const from = stateBefore(src, ops, a.group.first)
  const to = stateBefore(src, ops, b.group.last + 1)
  const bridge = bridgeState(from, to)
  if ('problem' in bridge) return bridge
  const aStart = ops[a.group.first].start
  const aEnd = ops[a.group.last].end
  const bEnd = ops[b.group.last].end
  const moved = src.slice(aStart, aEnd)
  // Where the move starts, drop the whitespace before the operators so no double space is left.
  let cut = aStart
  while (cut > 0 && /\s/.test(src[cut - 1])) cut--
  return { src: `${src.slice(0, cut)}${src.slice(aEnd, bEnd)}\nq ${bridge.ops}${moved}\nQ${src.slice(bEnd)}` }
}

/** The stream with the object wrapped in marked content that points at the optional content group `name`. */
export function wrapHidden(src: string, ops: Op[], obj: StreamObject, name: string): string {
  const s = ops[obj.first].start
  const e = ops[obj.last].end
  return `${src.slice(0, s)}/OC /${name} BDC ${src.slice(s, e)} EMC${src.slice(e)}`
}

/** The stream with a hiding wrapper taken off (the operators inside stay). */
export function unwrapHidden(src: string, ops: Op[], obj: StreamObject): string {
  if (!obj.hiddenBy) return src
  const open = ops[obj.first - 1]
  const close = ops[obj.last + 1]
  return `${src.slice(0, open.start)}${src.slice(open.end, close.start).replace(/^\s+/, '')}${src.slice(close.end)}`
}

/** The stream with one object's operators taken out (used for forms). */
export function removeObjectOps(src: string, ops: Op[], obj: StreamObject): string {
  const s = ops[obj.group.first].start
  const e = ops[obj.group.last].end
  let cut = s
  while (cut > 0 && /\s/.test(src[cut - 1])) cut--
  return `${src.slice(0, cut)}${src.slice(e)}`
}

/** Parses and lists in one step, for the callers that start from the text. */
export function listFromSource(src: string, isImage: (n: string) => boolean, isForm: (n: string) => boolean): { ops: Op[]; objects: StreamObject[] } {
  const ops = parseContent(src)
  return { ops, objects: listObjects(ops, isImage, isForm) }
}
