import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { writeAnnotations } from './annotWrite'
import { stampSize, withBounds, type Annot, type AnnotKind } from './annotations'

let nextId = 1
function annot(kind: AnnotKind, extra: Partial<Annot>): Annot {
  return withBounds({
    id: nextId++,
    page: 0,
    kind,
    color: '#e5322d',
    rects: [],
    text: '',
    fontSize: 12,
    lineWidth: 2,
    ...extra
  })
}

const SUBTYPES: Record<string, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  squiggly: 'Squiggly',
  caret: 'Caret',
  typewriter: 'FreeText',
  callout: 'FreeText',
  note: 'Text',
  textbox: 'FreeText',
  line: 'Line',
  arrow: 'Line',
  rectangle: 'Square',
  ellipse: 'Circle',
  ink: 'Ink',
  polygon: 'Polygon',
  polyline: 'PolyLine',
  cloud: 'Polygon',
  stamp: 'Stamp'
}

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  return doc.save()
}

function annotsOf(doc: PDFDocument, page = 0): PDFDict[] {
  const list = doc.getPage(page).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!list) return []
  return Array.from({ length: list.size() }, (_, i) => list.lookup(i, PDFDict))
}
const subtype = (d: PDFDict) => d.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText()

describe('writeAnnotations', () => {
  const stamp = stampSize('APPROVED')
  const all: Annot[] = [
    annot('highlight', { rects: [{ x: 50, y: 50, w: 100, h: 12 }], text: 'hi' }),
    annot('underline', { rects: [{ x: 50, y: 80, w: 100, h: 12 }] }),
    annot('strikeout', { rects: [{ x: 50, y: 110, w: 100, h: 12 }] }),
    annot('note', { rects: [{ x: 300, y: 50, w: 22, h: 22 }], text: 'A note' }),
    annot('textbox', { rects: [{ x: 300, y: 100, w: 180, h: 54 }], text: 'Some text in a box' }),
    annot('line', { points: [[{ x: 50, y: 200 }, { x: 200, y: 260 }]] }),
    annot('arrow', { points: [[{ x: 50, y: 300 }, { x: 200, y: 360 }]] }),
    annot('rectangle', { rects: [{ x: 300, y: 200, w: 120, h: 60 }] }),
    annot('ellipse', { rects: [{ x: 300, y: 300, w: 120, h: 60 }] }),
    annot('ink', {
      points: [[{ x: 50, y: 400 }, { x: 80, y: 420 }, { x: 120, y: 410 }, { x: 160, y: 450 }]]
    }),
    annot('stamp', { rects: [{ x: 300, y: 400, w: stamp.w, h: stamp.h }], text: 'APPROVED' }),
    annot('squiggly', { rects: [{ x: 50, y: 500, w: 100, h: 12 }] }),
    annot('caret', { rects: [{ x: 300, y: 500, w: 8, h: 10 }], text: 'insert me' }),
    annot('typewriter', { rects: [{ x: 50, y: 700, w: 20, h: 16 }], text: 'Typed on the page' }),
    annot('callout', { rects: [{ x: 300, y: 650, w: 160, h: 40 }], points: [[{ x: 250, y: 720 }]], text: 'Look here' }),
    annot('polygon', { points: [[{ x: 50, y: 750 }, { x: 120, y: 760 }, { x: 90, y: 800 }]], fill: '#fff4c2', dash: 'dashed' }),
    annot('polyline', { points: [[{ x: 150, y: 750 }, { x: 200, y: 790 }, { x: 240, y: 760 }]] }),
    annot('cloud', { points: [[{ x: 400, y: 740 }, { x: 520, y: 740 }, { x: 520, y: 800 }, { x: 400, y: 800 }]] })
  ]

  it('writes one annotation of each kind and the result reloads', async () => {
    const out = await writeAnnotations(await blankPdf(), all)
    const doc = await PDFDocument.load(out)
    const annots = annotsOf(doc)
    expect(annots).toHaveLength(all.length)
    expect(annots.map(subtype)).toEqual(all.map((a) => SUBTYPES[a.kind]))
  })

  it('gives every annotation a /Rect and an appearance stream', async () => {
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), all))
    for (const d of annotsOf(doc)) {
      expect(d.lookupMaybe(PDFName.of('Rect'), PDFArray)?.size()).toBe(4)
      expect(d.lookupMaybe(PDFName.of('AP'), PDFDict)).toBeDefined()
    }
  })

  it('writes nothing for an empty list', async () => {
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), []))
    expect(annotsOf(doc)).toHaveLength(0)
  })

  it('ignores annotations that point at a missing page', async () => {
    const stray = annot('rectangle', { page: 7, rects: [{ x: 1, y: 1, w: 10, h: 10 }] })
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), [stray]))
    expect(annotsOf(doc)).toHaveLength(0)
  })

  it('writes replace text as a caret grouped with the strikeout', async () => {
    const replace = annot('strikeout', { rects: [{ x: 50, y: 600, w: 100, h: 12 }], text: 'new words', replace: true })
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), [replace]))
    const list = annotsOf(doc)
    expect(list.map(subtype)).toEqual(['Caret', 'StrikeOut'])
    const [caret, strike] = list
    expect(strike.lookupMaybe(PDFName.of('IT'), PDFName)?.decodeText()).toBe('StrikeOutTextEdit')
    expect(strike.lookupMaybe(PDFName.of('RT'), PDFName)?.decodeText()).toBe('Group')
    expect(strike.lookup(PDFName.of('IRT'))).toBe(caret)
    expect(caret.lookup(PDFName.of('Contents'))?.toString()).toContain(Buffer.from('new words', 'utf16le').toString('hex').slice(0, 4).toUpperCase())
  })

  it('marks typewriters and callouts with their intent, and gives a callout its leader line', async () => {
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), all))
    const list = annotsOf(doc)
    const it = (d: PDFDict) => d.lookupMaybe(PDFName.of('IT'), PDFName)?.decodeText()
    const tw = list.find((d) => it(d) === 'FreeTextTypeWriter')!
    const co = list.find((d) => it(d) === 'FreeTextCallout')!
    expect(tw).toBeDefined()
    expect(co).toBeDefined()
    // The typewriter box was widened to fit its text (20 pt was too narrow).
    const r = tw.lookup(PDFName.of('Rect'), PDFArray)
    const width = (r.lookup(2) as unknown as { asNumber(): number }).asNumber() - (r.lookup(0) as unknown as { asNumber(): number }).asNumber()
    expect(width).toBeGreaterThan(60)
    expect(co.lookup(PDFName.of('CL'), PDFArray).size()).toBe(4)
    expect(co.lookup(PDFName.of('RD'), PDFArray).size()).toBe(4)
  })

  it('writes vertices, fill, dash and the cloud border effect', async () => {
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), all))
    const list = annotsOf(doc)
    const polys = list.filter((d) => subtype(d) === 'Polygon')
    expect(polys).toHaveLength(2)
    const [poly, cloud] = polys
    expect(poly.lookup(PDFName.of('Vertices'), PDFArray).size()).toBe(6)
    expect(poly.lookup(PDFName.of('IC'), PDFArray).size()).toBe(3)
    const bs = poly.lookup(PDFName.of('BS'), PDFDict)
    expect(bs.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText()).toBe('D')
    expect(bs.lookup(PDFName.of('D'), PDFArray).size()).toBe(2)
    expect(cloud.lookup(PDFName.of('BE'), PDFDict).lookupMaybe(PDFName.of('S'), PDFName)?.decodeText()).toBe('C')
    expect(list.find((d) => subtype(d) === 'PolyLine')!.lookup(PDFName.of('Vertices'), PDFArray).size()).toBe(6)
  })

  it('writes the author, and new replies and review states as Text annotations in reply', async () => {
    const parent = annot('highlight', {
      rects: [{ x: 50, y: 50, w: 100, h: 12 }],
      author: 'Site engineer',
      created: '2026-10-15T04:00:00.000Z',
      replies: [
        { id: 900, author: 'Reviewer', text: 'Agreed, fix on site.', date: '2026-10-15T05:00:00.000Z' },
        { id: 901, author: 'Reviewer', text: '', date: '2026-10-15T05:01:00.000Z', state: 'Accepted' }
      ]
    })
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), [parent]))
    const list = annotsOf(doc)
    expect(list.map(subtype)).toEqual(['Highlight', 'Text', 'Text'])
    const [hl, reply, state] = list
    const text = (d: PDFDict, k: string) => (d.lookup(PDFName.of(k)) as unknown as { decodeText(): string }).decodeText()
    expect(text(hl, 'T')).toBe('Site engineer')
    expect(reply.lookup(PDFName.of('IRT'))).toBe(hl)
    expect(text(reply, 'Contents')).toBe('Agreed, fix on site.')
    expect(text(state, 'State')).toBe('Accepted')
    expect(text(state, 'StateModel')).toBe('Review')
  })

  it('only adds replies to an unchanged annotation that was already in the file', async () => {
    const first = await writeAnnotations(await blankPdf(), [annot('note', { rects: [{ x: 300, y: 50, w: 22, h: 22 }], text: 'Original' })])
    const doc0 = await PDFDocument.load(first)
    const r = annotsOf(doc0)[0].lookup(PDFName.of('Rect'), PDFArray)
    const rect = [0, 1, 2, 3].map((i) => (r.lookup(i) as unknown as { asNumber(): number }).asNumber()) as [number, number, number, number]
    const existing = annot('note', {
      rects: [{ x: 0, y: 0, w: 1, h: 1 }], // deliberately wrong: it must not be rewritten
      text: 'Changed text that must not be written',
      origin: { index: 0, subtype: 1, rect },
      replies: [{ id: 902, author: 'A', text: 'A reply', date: '2026-10-15T05:00:00.000Z' }]
    })
    const doc = await PDFDocument.load(await writeAnnotations(first, [existing], [], new Set()))
    const list = annotsOf(doc)
    expect(list).toHaveLength(2)
    expect((list[0].lookup(PDFName.of('Contents')) as unknown as { decodeText(): string }).decodeText()).toBe('Original')
    expect(list[1].lookup(PDFName.of('IRT'))).toBe(list[0])
  })

  it('writes a turned stamp with a wider /Rect, its own size in /OPRot, and no /Contents', async () => {
    const turned = annot('stamp', { rects: [{ x: 100, y: 100, w: 200, h: 40 }], text: 'VOID', angle: 90, opacity: 0.5 })
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), [turned]))
    const d = annotsOf(doc)[0]
    const num = (arr: PDFArray) => [0, 1, 2, 3].map((i) => (arr.lookup(i) as unknown as { asNumber(): number }).asNumber())
    const rect = num(d.lookup(PDFName.of('Rect'), PDFArray))
    // Turned 90 degrees, the 200 x 40 box becomes 40 wide and 200 tall about the same centre (200, 120).
    expect(rect[2] - rect[0]).toBeCloseTo(40)
    expect(rect[3] - rect[1]).toBeCloseTo(200)
    expect(d.lookup(PDFName.of('OPRot'), PDFArray).size()).toBe(3)
    expect(d.get(PDFName.of('Contents'))).toBeUndefined()
    expect((d.lookup(PDFName.of('CA')) as unknown as { asNumber(): number }).asNumber()).toBeCloseTo(0.5)
  })
})
