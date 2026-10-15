// @vitest-environment jsdom
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { withBounds, type Annot, type AnnotKind } from './annotations'
import { fromFdf, fromNorms, fromXfdf, pageFrames, toFdf, toNorms, toXfdf } from './interchange'

let id = 1
const mk = (kind: AnnotKind, extra: Partial<Annot>): Annot =>
  withBounds({ id: id++, page: 0, kind, color: '#1f5fd1', rects: [], text: '', fontSize: 12, lineWidth: 2, ...extra })

const annots: Annot[] = [
  mk('highlight', { rects: [{ x: 50, y: 50, w: 100, h: 12 }], text: 'note this', author: 'Ann' }),
  mk('note', { rects: [{ x: 300, y: 50, w: 22, h: 22 }], text: 'Sticky', replies: [{ id: 999, author: 'Bob', text: 'Agreed', date: '2026-10-15T05:00:00.000Z' }, { id: 998, author: 'Bob', text: '', date: '2026-10-15T05:01:00.000Z', state: 'Accepted' }] }),
  mk('textbox', { rects: [{ x: 300, y: 120, w: 160, h: 40 }], text: 'Boxed', fontSize: 14, fontFamily: 'Times', color: '#000000' }),
  mk('arrow', { points: [[{ x: 50, y: 200 }, { x: 200, y: 260 }]] }),
  mk('rectangle', { rects: [{ x: 300, y: 200, w: 100, h: 60 }], fill: '#fff4c2', dash: 'dashed', opacity: 0.5 }),
  mk('cloud', { points: [[{ x: 50, y: 300 }, { x: 150, y: 300 }, { x: 150, y: 380 }]] }),
  mk('ink', { points: [[{ x: 300, y: 300 }, { x: 320, y: 330 }, { x: 350, y: 310 }]] }),
  mk('callout', { rects: [{ x: 300, y: 400, w: 150, h: 40 }], points: [[{ x: 250, y: 480 }]], text: 'Look', lineWidth: 1 })
]

async function frames(rotate = 0) {
  const doc = await PDFDocument.create()
  const p = doc.addPage([595, 842])
  if (rotate) p.setRotation({ type: 'degrees', angle: rotate } as never)
  return pageFrames(await doc.save())
}

function check(back: Annot[]) {
  expect(back.map((a) => a.kind)).toEqual(annots.map((a) => a.kind))
  back.forEach((b, i) => {
    const a = annots[i]
    expect(b.rects[0].x).toBeCloseTo(a.rects[0].x, 0)
    expect(b.rects[0].y).toBeCloseTo(a.rects[0].y, 0)
    expect(b.text).toBe(a.text)
  })
  const note = back.find((a) => a.kind === 'note')!
  expect(note.replies?.map((r) => [r.author, r.text, r.state ?? null])).toEqual([['Bob', 'Agreed', null], ['Bob', '', 'Accepted']])
  const rect = back.find((a) => a.kind === 'rectangle')!
  expect([rect.fill, rect.dash, rect.opacity]).toEqual(['#fff4c2', 'dashed', 0.5])
  const tb = back.find((a) => a.kind === 'textbox')!
  expect([tb.fontFamily, tb.fontSize]).toEqual(['Times', 14])
  expect(back.find((a) => a.kind === 'callout')!.points![0][0].x).toBeCloseTo(250, 0)
}

describe('XFDF and FDF', () => {
  for (const rotate of [0, 90]) {
    it(`round-trip through XFDF (page rotated ${rotate})`, async () => {
      const f = await frames(rotate)
      const xml = toXfdf(toNorms(annots, f), 'test.pdf')
      expect(xml).toContain('<xfdf xmlns="http://ns.adobe.com/xfdf/"')
      let n = 1000
      check(fromNorms(fromXfdf(xml), f, () => n++).annots)
    })
    it(`round-trip through FDF (page rotated ${rotate})`, async () => {
      const f = await frames(rotate)
      const fdf = toFdf(toNorms(annots, f), 'test.pdf')
      expect(new TextDecoder().decode(fdf.subarray(0, 8))).toBe('%FDF-1.2')
      let n = 2000
      check(fromNorms(await fromFdf(fdf), f, () => n++).annots)
    })
  }
})
