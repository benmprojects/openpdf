import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib'
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

  describe('line ends, cloud intensity, blend mode and flags', () => {
    const names = (arr: PDFArray) => Array.from({ length: arr.size() }, (_, i) => arr.lookup(i, PDFName).decodeText())
    const apText = (d: PDFDict) => {
      const n = d.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as unknown as { getContents(): Uint8Array }
      return new TextDecoder('latin1').decode(n.getContents())
    }
    const write = async (...a: Annot[]) => annotsOf(await PDFDocument.load(await writeAnnotations(await blankPdf(), a)))

    it('writes /LE for a line, an arrow and a polyline, with matching marks in the appearance', async () => {
      const pts = [{ x: 50, y: 400 }, { x: 250, y: 400 }]
      const [line, arrow, def, poly] = await write(
        annot('line', { points: [pts], lineStart: 'Circle', lineEnd: 'Diamond' }),
        annot('arrow', { points: [pts], lineEnd: 'ClosedArrow' }),
        annot('arrow', { points: [pts] }),
        annot('polyline', { points: [[...pts, { x: 250, y: 500 }]], lineStart: 'Square', lineEnd: 'Slash' })
      )
      expect(names(line.lookup(PDFName.of('LE'), PDFArray))).toEqual(['Circle', 'Diamond'])
      expect(names(arrow.lookup(PDFName.of('LE'), PDFArray))).toEqual(['None', 'ClosedArrow'])
      expect(names(def.lookup(PDFName.of('LE'), PDFArray))).toEqual(['None', 'OpenArrow'])
      expect(names(poly.lookup(PDFName.of('LE'), PDFArray))).toEqual(['Square', 'Slash'])
      // Circle (24 segments) and diamond markers add paths after the line itself.
      expect(apText(line).match(/ h /g)?.length ?? 0).toBeGreaterThanOrEqual(2)
      // A closed arrow is filled with the line colour; the open arrow is only stroked.
      expect(apText(arrow)).toContain(' B')
      expect(apText(def)).not.toContain(' B')
      // The marks stay inside the appearance box: /Rect is padded for them.
      const rect = line.lookup(PDFName.of('Rect'), PDFArray)
      expect(rect.size()).toBe(4)
    })

    it('draws a line with no end styles as before', async () => {
      const [line] = await write(annot('line', { points: [[{ x: 50, y: 400 }, { x: 250, y: 400 }]] }))
      expect(names(line.lookup(PDFName.of('LE'), PDFArray))).toEqual(['None', 'None'])
      expect(apText(line)).not.toContain(' h ')
    })

    it('writes the cloud intensity for a cloud, a polygon and a rectangle, and drops it at 0', async () => {
      const tri = [[{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 250 }]]
      const [cloud, big, poly, plain, rect, plainCloud] = await write(
        annot('cloud', { points: tri }),
        annot('cloud', { points: tri, cloud: 2 }),
        annot('polygon', { points: tri, cloud: 1 }),
        annot('polygon', { points: tri }),
        annot('rectangle', { rects: [{ x: 100, y: 400, w: 200, h: 120 }], cloud: 2 }),
        annot('cloud', { points: tri, cloud: 0 })
      )
      const intensity = (d: PDFDict) => d.lookupMaybe(PDFName.of('BE'), PDFDict)?.lookupMaybe(PDFName.of('I'), PDFNumber)?.asNumber()
      expect(intensity(cloud)).toBe(1)
      expect(intensity(big)).toBe(2)
      expect(intensity(poly)).toBe(1)
      expect(intensity(plain)).toBeUndefined()
      expect(intensity(rect)).toBe(2)
      expect(subtype(rect)).toBe('Square')
      expect(intensity(plainCloud)).toBeUndefined()
      // Larger scallops mean fewer curves.
      const curves = (d: PDFDict) => apText(d).match(/ c /g)?.length ?? 0
      expect(curves(big)).toBeLessThan(curves(cloud))
      expect(curves(rect)).toBeGreaterThan(4)
      expect(apText(plain)).not.toContain(' c ')
    })

    it('writes the blend mode in /BM and in the appearance; a highlight multiplies unless told otherwise', async () => {
      const [hl, hlNormal, shape, lone] = await write(
        annot('highlight', { rects: [{ x: 50, y: 50, w: 100, h: 12 }] }),
        annot('highlight', { rects: [{ x: 50, y: 80, w: 100, h: 12 }], blend: 'Normal' }),
        annot('rectangle', { rects: [{ x: 50, y: 200, w: 100, h: 50 }], blend: 'Multiply', opacity: 0.5 }),
        annot('rectangle', { rects: [{ x: 50, y: 300, w: 100, h: 50 }] })
      )
      const bmOfAp = (d: PDFDict) => {
        const n = (d.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as unknown as { dict: PDFDict }).dict
        const ext = n.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict)
        const gs = ext.lookup(ext.keys()[0], PDFDict)
        return gs.lookupMaybe(PDFName.of('BM'), PDFName)?.decodeText()
      }
      expect(bmOfAp(hl)).toBe('Multiply')
      expect(hl.has(PDFName.of('BM'))).toBe(false)
      expect(bmOfAp(hlNormal)).toBe('Normal')
      expect(hlNormal.lookupMaybe(PDFName.of('BM'), PDFName)?.decodeText()).toBe('Normal')
      expect(shape.lookupMaybe(PDFName.of('BM'), PDFName)?.decodeText()).toBe('Multiply')
      expect(bmOfAp(shape)).toBe('Multiply')
      expect(shape.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber()).toBe(0.5)
      expect(lone.has(PDFName.of('BM'))).toBe(false)
    })

    it('writes the Print and Locked flags, and keeps the flags an annotation from the file had', async () => {
      const flagsOf = (d: PDFDict) => d.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber()
      const r = { x: 50, y: 50, w: 100, h: 50 }
      const [normal, locked, noPrint, note] = await write(
        annot('rectangle', { rects: [r] }),
        annot('rectangle', { rects: [r], flags: 4 | 128 }),
        annot('rectangle', { rects: [r], flags: 0 }),
        annot('note', { rects: [{ x: 50, y: 300, w: 22, h: 22 }], flags: 4 | 128 })
      )
      expect(flagsOf(normal)).toBe(4)
      expect(flagsOf(locked)).toBe(132)
      expect(flagsOf(noPrint)).toBe(0)
      expect(flagsOf(note)).toBe(132)
    })

    it('updates an annotation from the file in place: new end styles replace old ones and a removed cloud border is dropped', async () => {
      const first = await writeAnnotations(await blankPdf(), [annot('polygon', { cloud: 1, points: [[{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 250 }]] })])
      const doc1 = await PDFDocument.load(first)
      const d1 = annotsOf(doc1)[0]
      const rect = d1.lookup(PDFName.of('Rect'), PDFArray)
      const origin = { index: 0, subtype: 7, rect: [0, 1, 2, 3].map((i) => rect.lookup(i, PDFNumber).asNumber()) as [number, number, number, number] }
      const edited = annot('polygon', { cloud: 0, points: [[{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 250 }]], origin, flags: 4 | 128 })
      const out = await PDFDocument.load(await writeAnnotations(first, [edited]))
      const d2 = annotsOf(out)[0]
      expect(d2.has(PDFName.of('BE'))).toBe(false)
      expect(d2.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber()).toBe(132)
    })
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

describe('writeAnnotations: checked flag, subject, layer, note icons and angles', () => {
  const text = (d: PDFDict, k: string) => (d.lookup(PDFName.of(k)) as unknown as { decodeText(): string }).decodeText()
  const num = (d: PDFDict, k: string) => (d.lookup(PDFName.of(k)) as unknown as { asNumber(): number }).asNumber()

  it('writes the checked flag as a reply in the Marked state model', async () => {
    const parent = annot('highlight', {
      rects: [{ x: 50, y: 50, w: 100, h: 12 }],
      replies: [
        { id: 1000, author: 'Checker', text: '', date: '2026-10-16T01:00:00.000Z', mark: 'Marked' },
        { id: 1001, author: 'Checker', text: '', date: '2026-10-16T02:00:00.000Z', mark: 'Unmarked' }
      ]
    })
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), [parent]))
    const list = annotsOf(doc)
    expect(list.map(subtype)).toEqual(['Highlight', 'Text', 'Text'])
    expect(text(list[1], 'State')).toBe('Marked')
    expect(text(list[1], 'StateModel')).toBe('Marked')
    expect(text(list[2], 'State')).toBe('Unmarked')
    expect(list[1].lookup(PDFName.of('IRT'))).toBe(list[0])
  })

  it('writes each note icon as /Name, with an appearance of its own', async () => {
    const icons = ['Comment', 'Note', 'Help', 'Key', 'Paragraph', 'Insert'] as const
    const notes = icons.map((icon, i) => annot('note', { rects: [{ x: 40 + i * 30, y: 40, w: 22, h: 22 }], text: icon, icon }))
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), notes))
    const list = annotsOf(doc)
    expect(list.map((d) => d.lookup(PDFName.of('Name'), PDFName).decodeText())).toEqual([...icons])
    const streams = list.map((d) => {
      const ap = d.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N')) as PDFRef
      return new TextDecoder('latin1').decode((doc.context.lookup(ap) as unknown as { getContents(): Uint8Array }).getContents())
    })
    expect(new Set(streams).size).toBe(icons.length)
  })

  it('writes the subject, and drops it from an annotation in the file when it is cleared', async () => {
    const first = await writeAnnotations(await blankPdf(), [annot('rectangle', { rects: [{ x: 50, y: 50, w: 80, h: 40 }], subject: 'Pit lid' })])
    const doc = await PDFDocument.load(first)
    expect(text(annotsOf(doc)[0], 'Subj')).toBe('Pit lid')
    const r = annotsOf(doc)[0].lookup(PDFName.of('Rect'), PDFArray)
    const rect = [0, 1, 2, 3].map((i) => (r.lookup(i) as unknown as { asNumber(): number }).asNumber()) as [number, number, number, number]
    const again = annot('rectangle', { rects: [{ x: 50, y: 50, w: 80, h: 40 }], origin: { index: 0, subtype: 5, rect } })
    const out = await PDFDocument.load(await writeAnnotations(first, [again], [], new Set([again.id])))
    // The kind still writes its own default subject, but not the cleared one.
    expect(text(annotsOf(out)[0], 'Subj')).toBe('Rectangle')
  })

  it('moves an annotation to a layer by writing /OC, and ignores a layer the file does not have', async () => {
    const base = await PDFDocument.create()
    base.addPage([595, 842])
    const ocg = base.context.register(base.context.obj({ Type: 'OCG', Name: 'Services' } as never))
    base.catalog.set(PDFName.of('OCProperties'), base.context.obj({ OCGs: [ocg], D: { Order: [ocg] } } as never))
    const bytes = await base.save()
    const key = `${ocg.objectNumber} ${ocg.generationNumber}`
    const on = annot('rectangle', { rects: [{ x: 50, y: 50, w: 80, h: 40 }], layer: key })
    const off = annot('rectangle', { rects: [{ x: 50, y: 150, w: 80, h: 40 }], layer: '999 0' })
    const doc = await PDFDocument.load(await writeAnnotations(bytes, [on, off]))
    const [a, b] = annotsOf(doc)
    expect((a.get(PDFName.of('OC')) as PDFRef).objectNumber).toBe(ocg.objectNumber)
    expect(b.get(PDFName.of('OC'))).toBeUndefined()
  })

  it('writes an angle as a polyline with its degrees in /OPAngle and no /Measure', async () => {
    const pts = [{ x: 100, y: 100 }, { x: 100, y: 200 }, { x: 200, y: 200 }]
    const a = annot('polyline', { points: [pts], lineWidth: 1, measure: { kind: 'angle', factor: 1, unit: '°', label: '90.0°', name: 'Kerb return' } })
    const doc = await PDFDocument.load(await writeAnnotations(await blankPdf(), [a]))
    const d = annotsOf(doc)[0]
    expect(subtype(d)).toBe('PolyLine')
    expect(num(d, 'OPAngle')).toBeCloseTo(90)
    expect(text(d, 'Subj')).toBe('Angle')
    expect(text(d, 'Contents')).toBe('90.0°')
    expect(text(d, 'OPName')).toBe('Kerb return')
    expect(d.get(PDFName.of('Measure'))).toBeUndefined()
    expect(d.get(PDFName.of('IT'))).toBeUndefined()
  })
})
