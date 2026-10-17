/**
 * Comment interchange: XFDF (ISO 19444-1, XML) and FDF (ISO 32000 12.7.8). Both go through one normalised form
 * in PDF user space; page geometry (crop box and /Rotate) maps it to and from the display space annotations use.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'
import { frameFor, type Frame } from './annotWrite'
import { isVertexKind, pathBounds, type Annot, type AnnotKind, type Pt, type Reply, type ReviewState } from './annotations'
import type { Rect } from './textLogic'

/** One annotation in PDF terms, user space. */
export interface Norm {
  subtype: string
  page: number
  rect: [number, number, number, number]
  name?: string
  inReplyTo?: string
  color?: [number, number, number]
  interior?: [number, number, number]
  opacity?: number
  contents?: string
  author?: string
  created?: string
  modified?: string
  state?: string
  width?: number
  dash?: number[]
  quads?: number[]
  vertices?: number[]
  ink?: number[][]
  line?: [number, number, number, number]
  le?: [string, string]
  icon?: string
  da?: string
  it?: string
  cl?: number[]
  rd?: number[]
}

// ---- Page geometry -------------------------------------------------------------------------------------------
export async function pageFrames(bytes: Uint8Array): Promise<Frame[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  return doc.getPages().map((p) => {
    const cb = p.getCropBox()
    return frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, p.getRotation().angle)
  })
}

const toUser = (f: Frame, x: number, y: number): [number, number] => {
  const [a, b, c, d, e, g] = f.m
  return [a * x + c * y + e, b * x + d * y + g]
}
const toDisplay = (f: Frame, ux: number, uy: number): Pt => {
  const [a, b, c, d, e, g] = f.m
  const det = a * d - b * c || 1
  const x = ux - e
  const y = uy - g
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det }
}
function userRect(f: Frame, rects: Rect[]): [number, number, number, number] {
  const pts = rects.flatMap((r) => [toUser(f, r.x, r.y), toUser(f, r.x + r.w, r.y + r.h), toUser(f, r.x + r.w, r.y), toUser(f, r.x, r.y + r.h)])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
function displayRect(f: Frame, r: [number, number, number, number]): Rect {
  const a = toDisplay(f, r[0], r[1])
  const b = toDisplay(f, r[2], r[3])
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const rgbToHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`
export function pdfDate(iso?: string): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (isNaN(d.getTime())) return undefined
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

const SUBTYPE: Partial<Record<AnnotKind, string>> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  squiggly: 'Squiggly',
  caret: 'Caret',
  note: 'Text',
  textbox: 'FreeText',
  typewriter: 'FreeText',
  callout: 'FreeText',
  line: 'Line',
  arrow: 'Line',
  rectangle: 'Square',
  ellipse: 'Circle',
  ink: 'Ink',
  polygon: 'Polygon',
  cloud: 'Polygon',
  polyline: 'PolyLine',
  stamp: 'Stamp'
}

// ---- Annot <-> Norm ---------------------------------------------------------------------------------------------
/** Our annotations (and their replies) in PDF terms. Kinds without an interchange form are left out. */
export function toNorms(annots: Annot[], frames: Frame[]): Norm[] {
  const out: Norm[] = []
  annots.forEach((a, i) => {
    const subtype = SUBTYPE[a.kind]
    const f = frames[a.page]
    if (!subtype || !f || !a.rects.length) return
    const name = `openpdf-${i + 1}`
    const n: Norm = {
      subtype,
      page: a.page,
      rect: userRect(f, a.rects),
      name,
      color: hexToRgb(a.color),
      contents: a.kind === 'stamp' ? (a.text + (a.stampInfo ? `\n${a.stampInfo}` : '')) : a.text,
      author: a.author,
      created: pdfDate(a.created),
      modified: pdfDate(a.modified ?? a.created),
      ...(a.opacity !== undefined ? { opacity: a.opacity } : {}),
      ...(a.fill ? { interior: hexToRgb(a.fill) } : {})
    }
    if (a.kind === 'rectangle' || a.kind === 'ellipse' || a.kind === 'ink' || a.kind === 'line' || a.kind === 'arrow' || isVertexKind(a.kind) || a.kind === 'stamp')
      n.width = a.lineWidth
    if (a.dash) n.dash = a.dash === 'dotted' ? [0.5, a.lineWidth * 2 + 1] : [a.lineWidth * 3 + 2, a.lineWidth * 2 + 2]
    if (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout' || a.kind === 'squiggly') {
      n.quads = a.rects.flatMap((r) => [...toUser(f, r.x, r.y), ...toUser(f, r.x + r.w, r.y), ...toUser(f, r.x, r.y + r.h), ...toUser(f, r.x + r.w, r.y + r.h)])
    }
    if ((a.kind === 'line' || a.kind === 'arrow') && a.points?.[0]?.length === 2) {
      const [p0, p1] = a.points[0]
      n.line = [...toUser(f, p0.x, p0.y), ...toUser(f, p1.x, p1.y)] as [number, number, number, number]
      n.le = ['None', a.kind === 'arrow' ? 'OpenArrow' : 'None']
    }
    if (isVertexKind(a.kind) && a.points?.[0]) n.vertices = a.points[0].flatMap((p) => toUser(f, p.x, p.y))
    if (a.kind === 'cloud') n.it = 'Cloud'
    if (a.kind === 'ink' && a.points) n.ink = a.points.map((path) => path.flatMap((p) => toUser(f, p.x, p.y)))
    if (a.kind === 'note') n.icon = 'Comment'
    if (a.kind === 'stamp') n.icon = 'Draft'
    if (a.kind === 'textbox' || a.kind === 'typewriter' || a.kind === 'callout') {
      const tag = a.fontFamily === 'Times' ? 'TiRo' : a.fontFamily === 'Courier' ? 'Cour' : 'Helv'
      const [r, g, b] = hexToRgb(a.color)
      n.da = `/${tag} ${a.fontSize} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`
      if (a.kind === 'typewriter') n.it = 'FreeTextTypeWriter'
      if (a.kind === 'callout' && a.points?.[0]?.[0]) {
        n.it = 'FreeTextCallout'
        const tip = a.points[0][0]
        const box = a.rects[0]
        const all = userRect(f, [box, { x: tip.x - 1, y: tip.y - 1, w: 2, h: 2 }])
        const inner = userRect(f, [box])
        n.rect = all
        n.rd = [inner[0] - all[0], inner[1] - all[1], all[2] - inner[2], all[3] - inner[3]]
        n.cl = [...toUser(f, tip.x, tip.y), ...toUser(f, box.x, box.y + box.h / 2)]
      }
    }
    out.push(n)
    for (const r of a.replies ?? []) {
      // The checked flag is not part of the interchange format.
      if (r.mark) continue
      out.push({
        subtype: 'Text',
        page: a.page,
        rect: n.rect,
        name: `${name}-r${r.id}`,
        inReplyTo: name,
        contents: r.text,
        author: r.author,
        created: pdfDate(r.date),
        modified: pdfDate(r.date),
        ...(r.state ? { state: r.state } : {})
      })
    }
  })
  return out
}

/** Normalised annotations back to ours (display space), with replies attached to their parents. */
export function fromNorms(norms: Norm[], frames: Frame[], nextId: () => number): { annots: Annot[]; skipped: number } {
  const byName = new Map<string, Annot>()
  const annots: Annot[] = []
  let skipped = 0
  const replies: Norm[] = []
  for (const n of norms) {
    const f = frames[n.page]
    if (!f) {
      skipped++
      continue
    }
    if (n.inReplyTo && n.subtype === 'Text') {
      replies.push(n)
      continue
    }
    const pts = (arr: number[]) => {
      const out: Pt[] = []
      for (let i = 0; i + 1 < arr.length; i += 2) out.push(toDisplay(f, arr[i], arr[i + 1]))
      return out
    }
    const base: Omit<Annot, 'kind' | 'rects'> = {
      id: nextId(),
      page: n.page,
      color: n.color ? rgbToHex(n.color) : '#e5322d',
      text: n.contents ?? '',
      fontSize: 12,
      lineWidth: n.width ?? 1,
      author: n.author,
      ...(n.opacity !== undefined && n.opacity < 1 ? { opacity: n.opacity } : {}),
      ...(n.interior ? { fill: rgbToHex(n.interior) } : {}),
      ...(n.dash?.length ? { dash: n.dash[0] <= Math.max(1, n.width ?? 1) ? ('dotted' as const) : ('dashed' as const) } : {})
    }
    let a: Annot | null = null
    const box = displayRect(f, n.rect)
    switch (n.subtype) {
      case 'Highlight':
      case 'Underline':
      case 'StrikeOut':
      case 'Squiggly': {
        const kind = ({ Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout', Squiggly: 'squiggly' } as const)[n.subtype]
        const rects: Rect[] = []
        for (let i = 0; n.quads && i + 7 < n.quads.length; i += 8) {
          const q = pts(n.quads.slice(i, i + 8))
          const xs = q.map((p) => p.x)
          const ys = q.map((p) => p.y)
          rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) })
        }
        a = { ...base, kind, rects: rects.length ? rects : [box] }
        break
      }
      case 'Text':
        a = { ...base, kind: 'note', rects: [{ x: box.x, y: box.y, w: Math.max(box.w, 22), h: Math.max(box.h, 22) }] }
        break
      case 'Caret':
        a = { ...base, kind: 'caret', rects: [box] }
        break
      case 'FreeText': {
        const size = Number(/([\d.]+)\s+Tf/.exec(n.da ?? '')?.[1] ?? 12)
        const face = /\/(\S+)\s+[\d.]+\s+Tf/.exec(n.da ?? '')?.[1] ?? ''
        const rgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(n.da ?? '')
        const textColour = rgb ? rgbToHex([+rgb[1], +rgb[2], +rgb[3]]) : '#000000'
        const fontFamily = /^(TiRo|Times)/i.test(face) ? ('Times' as const) : /^(Cour)/i.test(face) ? ('Courier' as const) : undefined
        if (n.it === 'FreeTextCallout' && n.cl && n.cl.length >= 4) {
          const rd = n.rd ?? [0, 0, 0, 0]
          const inner = displayRect(f, [n.rect[0] + rd[0], n.rect[1] + rd[1], n.rect[2] - rd[2], n.rect[3] - rd[3]])
          a = { ...base, kind: 'callout', color: n.color ? rgbToHex(n.color) : textColour, rects: [inner], points: [[toDisplay(f, n.cl[0], n.cl[1])]], fontSize: size, lineWidth: 1, fontFamily }
        } else {
          a = { ...base, kind: n.it === 'FreeTextTypeWriter' ? 'typewriter' : 'textbox', color: textColour, rects: [box], fontSize: size, fontFamily }
        }
        break
      }
      case 'Line':
        if (n.line) {
          const p = pts(n.line)
          const arrow = (n.le ?? []).some((e) => /Arrow/.test(e))
          const startOnly = n.le && /Arrow/.test(n.le[0]) && !/Arrow/.test(n.le[1])
          const path = startOnly ? [p[1], p[0]] : p
          a = { ...base, kind: arrow ? 'arrow' : 'line', rects: [], points: [path] }
        }
        break
      case 'Square':
        a = { ...base, kind: 'rectangle', rects: [box] }
        break
      case 'Circle':
        a = { ...base, kind: 'ellipse', rects: [box] }
        break
      case 'Polygon':
      case 'PolyLine':
        if (n.vertices && n.vertices.length >= 4) {
          a = { ...base, kind: n.subtype === 'PolyLine' ? 'polyline' : n.it === 'Cloud' ? 'cloud' : 'polygon', rects: [], points: [pts(n.vertices)] }
        }
        break
      case 'Ink':
        if (n.ink?.length) a = { ...base, kind: 'ink', rects: [], points: n.ink.map(pts) }
        break
      case 'Stamp': {
        const [label, ...info] = (n.contents ?? 'STAMP').split('\n')
        a = { ...base, kind: 'stamp', rects: [box], text: label || 'STAMP', lineWidth: n.width ?? 2, ...(info.length ? { stampInfo: info.join(' ') } : {}) }
        break
      }
    }
    if (!a) {
      skipped++
      continue
    }
    if (a.points && a.kind !== 'callout') a.rects = [pathBounds(a.kind, a.lineWidth, a.points)]
    annots.push(a)
    if (n.name) byName.set(n.name, a)
  }
  for (const r of replies) {
    const parent = r.inReplyTo ? byName.get(r.inReplyTo) : undefined
    if (!parent) {
      skipped++
      continue
    }
    const reply: Reply = {
      id: nextId(),
      author: r.author ?? '',
      text: r.contents ?? '',
      date: isoFromPdf(r.modified ?? r.created) ?? new Date().toISOString(),
      ...(r.state ? { state: r.state as ReviewState } : {})
    }
    parent.replies = [...(parent.replies ?? []), reply]
  }
  return { annots, skipped }
}

function isoFromPdf(s?: string): string | undefined {
  const m = s ? /^D?:?(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(s) : null
  if (!m) return undefined
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)))
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

// ---- XFDF -------------------------------------------------------------------------------------------------------------
const XFDF_ELEMENT: Record<string, string> = {
  Text: 'text',
  FreeText: 'freetext',
  Line: 'line',
  Square: 'square',
  Circle: 'circle',
  Polygon: 'polygon',
  PolyLine: 'polyline',
  Highlight: 'highlight',
  Underline: 'underline',
  Squiggly: 'squiggly',
  StrikeOut: 'strikeout',
  Stamp: 'stamp',
  Caret: 'caret',
  Ink: 'ink'
}
const XFDF_SUBTYPE = Object.fromEntries(Object.entries(XFDF_ELEMENT).map(([k, v]) => [v, k]))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (v: number) => String(Math.round(v * 1000) / 1000)
const list = (v: number[]) => v.map(num).join(',')

export function toXfdf(norms: Norm[], fileName: string): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">', `<f href="${esc(fileName)}"/>`, '<annots>']
  for (const n of norms) {
    const el = XFDF_ELEMENT[n.subtype]
    if (!el) continue
    const attrs: [string, string | undefined][] = [
      ['page', String(n.page)],
      ['rect', list(n.rect)],
      ['name', n.name],
      ['inreplyto', n.inReplyTo],
      ['title', n.author],
      ['creationdate', n.created],
      ['date', n.modified],
      ['color', n.color ? rgbToHex(n.color).toUpperCase() : undefined],
      ['interior-color', n.interior ? rgbToHex(n.interior).toUpperCase() : undefined],
      ['opacity', n.opacity !== undefined ? num(n.opacity) : undefined],
      ['width', n.width !== undefined ? num(n.width) : undefined],
      ['style', n.dash ? 'dash' : undefined],
      ['dashes', n.dash ? list(n.dash) : undefined],
      ['coords', n.quads ? list(n.quads) : undefined],
      ['icon', n.icon],
      ['intent', n.it],
      ['state', n.state],
      ['statemodel', n.state ? 'Review' : undefined],
      ['start', n.line ? `${num(n.line[0])},${num(n.line[1])}` : undefined],
      ['end', n.line ? `${num(n.line[2])},${num(n.line[3])}` : undefined],
      ['head', n.le?.[0]],
      ['tail', n.le?.[1]],
      ['callout', n.cl ? list(n.cl) : undefined],
      ['fringe', n.rd ? list(n.rd) : undefined]
    ]
    const head = `<${el} ${attrs.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}="${esc(v!)}"`).join(' ')}>`
    const body: string[] = []
    if (n.contents) body.push(`<contents>${esc(n.contents)}</contents>`)
    if (n.da) body.push(`<defaultappearance>${esc(n.da)}</defaultappearance>`)
    if (n.vertices) body.push(`<vertices>${n.vertices.reduce<string[]>((acc, v, i) => (i % 2 ? (acc[acc.length - 1] += `,${num(v)}`, acc) : [...acc, num(v)]), []).join(';')}</vertices>`)
    if (n.ink) body.push(`<inklist>${n.ink.map((g) => `<gesture>${g.reduce<string[]>((acc, v, i) => (i % 2 ? (acc[acc.length - 1] += `,${num(v)}`, acc) : [...acc, num(v)]), []).join(';')}</gesture>`).join('')}</inklist>`)
    out.push(`${head}${body.join('')}</${el}>`)
  }
  out.push('</annots>', '</xfdf>')
  return out.join('\n')
}

export function fromXfdf(xml: string): Norm[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This is not a readable XFDF file.')
  const annots = doc.getElementsByTagName('annots')[0]
  if (!annots) return []
  const nums = (s: string | null) => (s ? s.split(/[,;\s]+/).filter(Boolean).map(Number) : undefined)
  const colour = (s: string | null) => (s && /^#[0-9a-f]{6}$/i.test(s) ? hexToRgb(s) : undefined)
  const out: Norm[] = []
  for (const el of Array.from(annots.children)) {
    const subtype = XFDF_SUBTYPE[el.localName]
    const rect = nums(el.getAttribute('rect'))
    if (!subtype || !rect || rect.length !== 4) continue
    const text = (tag: string) => el.getElementsByTagName(tag)[0]?.textContent ?? undefined
    const start = nums(el.getAttribute('start'))
    const end = nums(el.getAttribute('end'))
    const op = el.getAttribute('opacity')
    out.push({
      subtype,
      page: Number(el.getAttribute('page') ?? 0),
      rect: rect as Norm['rect'],
      name: el.getAttribute('name') ?? undefined,
      inReplyTo: el.getAttribute('inreplyto') ?? undefined,
      author: el.getAttribute('title') ?? undefined,
      created: el.getAttribute('creationdate') ?? undefined,
      modified: el.getAttribute('date') ?? undefined,
      color: colour(el.getAttribute('color')),
      interior: colour(el.getAttribute('interior-color')),
      opacity: op ? Number(op) : undefined,
      width: el.getAttribute('width') ? Number(el.getAttribute('width')) : undefined,
      dash: el.getAttribute('style') === 'dash' ? (nums(el.getAttribute('dashes')) ?? [3]) : undefined,
      quads: nums(el.getAttribute('coords')),
      icon: el.getAttribute('icon') ?? undefined,
      it: el.getAttribute('intent') ?? undefined,
      state: el.getAttribute('state') ?? undefined,
      line: start && end ? [start[0], start[1], end[0], end[1]] : undefined,
      le: el.getAttribute('head') || el.getAttribute('tail') ? [el.getAttribute('head') ?? 'None', el.getAttribute('tail') ?? 'None'] : undefined,
      cl: nums(el.getAttribute('callout')),
      rd: nums(el.getAttribute('fringe')),
      contents: text('contents'),
      da: text('defaultappearance'),
      vertices: nums(text('vertices') ?? null),
      ink: Array.from(el.getElementsByTagName('gesture')).map((g) => nums(g.textContent) ?? [])
    })
    const last = out[out.length - 1]
    if (!last.ink?.length) delete last.ink
  }
  return out
}

// ---- FDF ---------------------------------------------------------------------------------------------------------------
const pdfStr = (s: string) => {
  // UTF-16BE with a byte-order mark, as a hex string: safe for any text.
  let hex = 'FEFF'
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp > 0xffff) {
      const v = cp - 0x10000
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else hex += cp.toString(16).padStart(4, '0')
  }
  return `<${hex.toUpperCase()}>`
}
const arr = (v: number[]) => `[${v.map(num).join(' ')}]`

export function toFdf(norms: Norm[], fileName: string): Uint8Array {
  const objs: string[] = []
  const refs = new Map<string, number>()
  norms.forEach((n, i) => n.name && refs.set(n.name, i + 2))
  norms.forEach((n) => {
    const e: string[] = [`/Type /Annot`, `/Subtype /${n.subtype}`, `/Page ${n.page}`, `/Rect ${arr(n.rect)}`]
    if (n.name) e.push(`/NM ${pdfStr(n.name)}`)
    if (n.inReplyTo && refs.has(n.inReplyTo)) e.push(`/IRT ${refs.get(n.inReplyTo)} 0 R`)
    if (n.color) e.push(`/C ${arr(n.color)}`)
    if (n.interior) e.push(`/IC ${arr(n.interior)}`)
    if (n.opacity !== undefined) e.push(`/CA ${num(n.opacity)}`)
    if (n.contents) e.push(`/Contents ${pdfStr(n.contents)}`)
    if (n.author) e.push(`/T ${pdfStr(n.author)}`)
    if (n.created) e.push(`/CreationDate (${n.created})`)
    if (n.modified) e.push(`/M (${n.modified})`)
    if (n.state) e.push(`/State ${pdfStr(n.state)} /StateModel (Review)`)
    if (n.width !== undefined) e.push(`/BS << /W ${num(n.width)}${n.dash ? ` /S /D /D ${arr(n.dash)}` : ''} >>`)
    if (n.quads) e.push(`/QuadPoints ${arr(n.quads)}`)
    if (n.vertices) e.push(`/Vertices ${arr(n.vertices)}`)
    if (n.ink) e.push(`/InkList [${n.ink.map(arr).join(' ')}]`)
    if (n.line) e.push(`/L ${arr(n.line)}`)
    if (n.le) e.push(`/LE [/${n.le[0]} /${n.le[1]}]`)
    if (n.icon) e.push(`/Name /${n.icon}`)
    if (n.da) e.push(`/DA (${n.da.replace(/[()\\]/g, (c) => `\\${c}`)})`)
    if (n.it) e.push(n.it === 'Cloud' ? `/BE << /S /C /I 1 >>` : `/IT /${n.it}`)
    if (n.cl) e.push(`/CL ${arr(n.cl)}`)
    if (n.rd) e.push(`/RD ${arr(n.rd)}`)
    objs.push(e.join(' '))
  })
  const parts = ['%FDF-1.2\n%\xe2\xe3\xcf\xd3\n']
  const offsets: number[] = []
  const enc = new TextEncoder()
  let size = enc.encode(parts[0]).length
  const add = (s: string) => {
    parts.push(s)
    size += enc.encode(s).length
  }
  offsets.push(size)
  add(`1 0 obj\n<< /FDF << /F ${pdfStr(fileName)} /Annots [${objs.map((_, i) => `${i + 2} 0 R`).join(' ')}] >> >>\nendobj\n`)
  objs.forEach((o, i) => {
    offsets.push(size)
    add(`${i + 2} 0 obj\n<< ${o} >>\nendobj\n`)
  })
  add(`trailer\n<< /Root 1 0 R >>\n%%EOF\n`)
  void offsets
  return enc.encode(parts.join(''))
}

export async function fromFdf(bytes: Uint8Array): Promise<Norm[]> {
  const copy = new Uint8Array(bytes)
  const head = new TextDecoder('latin1').decode(copy.subarray(0, 8))
  if (!head.startsWith('%FDF-')) throw new Error('This is not an FDF file.')
  copy.set(new TextEncoder().encode('%PDF-'), 0)
  const doc = await PDFDocument.load(copy, { updateMetadata: false, throwOnInvalidObject: false })
  const root = doc.context.lookup(doc.context.trailerInfo.Root) as PDFDict | undefined
  const fdf = root?.lookupMaybe(PDFName.of('FDF'), PDFDict)
  const list = fdf?.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!list) return []
  const refName = new Map<string, string>()
  const out: Norm[] = []
  const text = (d: PDFDict, k: string) => {
    const v = d.lookup(PDFName.of(k))
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined
  }
  const nums = (d: PDFDict | undefined, k: string) => {
    const a = d?.lookupMaybe(PDFName.of(k), PDFArray)
    if (!a) return undefined
    return Array.from({ length: a.size() }, (_, i) => a.lookupMaybe(i, PDFNumber)?.asNumber() ?? 0)
  }
  const name = (d: PDFDict | undefined, k: string) => d?.lookupMaybe(PDFName.of(k), PDFName)?.decodeText()
  for (let i = 0; i < list.size(); i++) {
    const ref = list.get(i)
    const d = list.lookupMaybe(i, PDFDict)
    if (!d) continue
    const subtype = name(d, 'Subtype')
    const rect = nums(d, 'Rect')
    if (!subtype || !rect || rect.length !== 4) continue
    const nm = text(d, 'NM') ?? `fdf-${i}`
    if (ref instanceof PDFRef) refName.set(ref.toString(), nm)
    const bs = d.lookupMaybe(PDFName.of('BS'), PDFDict)
    const ink = d.lookupMaybe(PDFName.of('InkList'), PDFArray)
    const le = d.lookupMaybe(PDFName.of('LE'), PDFArray)
    const irt = d.get(PDFName.of('IRT'))
    out.push({
      subtype,
      page: d.lookupMaybe(PDFName.of('Page'), PDFNumber)?.asNumber() ?? 0,
      rect: rect as Norm['rect'],
      name: nm,
      inReplyTo: irt ? `ref:${irt.toString()}` : undefined,
      color: nums(d, 'C') as Norm['color'],
      interior: nums(d, 'IC') as Norm['interior'],
      opacity: d.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber(),
      contents: text(d, 'Contents'),
      author: text(d, 'T'),
      created: text(d, 'CreationDate'),
      modified: text(d, 'M'),
      state: text(d, 'State'),
      width: bs?.lookupMaybe(PDFName.of('W'), PDFNumber)?.asNumber(),
      dash: name(bs, 'S') === 'D' ? (nums(bs, 'D') ?? [3]) : undefined,
      quads: nums(d, 'QuadPoints'),
      vertices: nums(d, 'Vertices'),
      ink: ink ? Array.from({ length: ink.size() }, (_, k) => arrayNums(ink.lookup(k))) : undefined,
      line: nums(d, 'L') as Norm['line'],
      le: le ? [le.lookupMaybe(0, PDFName)?.decodeText() ?? 'None', le.lookupMaybe(1, PDFName)?.decodeText() ?? 'None'] : undefined,
      icon: name(d, 'Name'),
      da: text(d, 'DA'),
      it: name(d, 'IT') ?? (d.lookupMaybe(PDFName.of('BE'), PDFDict) ? 'Cloud' : undefined),
      cl: nums(d, 'CL'),
      rd: nums(d, 'RD')
    })
  }
  // /IRT points at objects; turn those into names.
  for (const n of out) if (n.inReplyTo?.startsWith('ref:')) n.inReplyTo = refName.get(n.inReplyTo.slice(4))
  return out
}

function arrayNums(o: unknown): number[] {
  if (!(o instanceof PDFArray)) return []
  return Array.from({ length: o.size() }, (_, i) => o.lookupMaybe(i, PDFNumber)?.asNumber() ?? 0)
}
