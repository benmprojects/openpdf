import { describe, expect, it } from 'vitest'
import { glyphPathOps, isChecked, noteGlyph, NOTE_ICONS, reviewHistory, type Annot } from './annotations'
import { copyable, pasteAnnots } from './annotClipboard'
import { filterComments, groupComments, NO_FILTER, NO_SUBJECT, sortComments, subjectsOf } from './commentList'
import { exportStyleSet, mergeStyleSets, parseStyleSet, sanitiseStyle } from './commentStyle'
import { angleAt, angleLabel, constrainToStep, formatAngle, measureCaption, measureLabelAt } from './measure'
import { measureCsv, measureRows, measureTotals } from './measureList'
import { exportScaleList, mergeScaleLists, parseScaleList } from './measureScale'
import { buildCorrection } from './textCorrection'

let id = 1
const mk = (extra: Partial<Annot> = {}): Annot => ({ id: id++, page: 0, kind: 'note', color: '#ffd400', rects: [{ x: 10, y: 10, w: 22, h: 22 }], text: '', fontSize: 12, lineWidth: 1, ...extra })
const when = (n: number) => `2026-10-16T0${n}:00:00.000Z`

describe('checked flag and review history', () => {
  it('takes the latest mark in the thread', () => {
    expect(isChecked(mk())).toBe(false)
    const marked = mk({ replies: [{ id: 1, author: 'A', text: '', date: when(1), mark: 'Marked' }] })
    expect(isChecked(marked)).toBe(true)
    expect(isChecked({ replies: [...marked.replies!, { id: 2, author: 'A', text: '', date: when(2), mark: 'Unmarked' }] })).toBe(false)
  })
  it('lists creation, replies, status, ticks and changes oldest first', () => {
    const a = mk({
      author: 'Author One',
      created: when(1),
      modified: when(5),
      replies: [
        { id: 1, author: 'Reviewer', text: 'Fix it', date: when(2) },
        { id: 2, author: 'Reviewer', text: '', date: when(3), state: 'Accepted' },
        { id: 3, author: 'Reviewer', text: '', date: when(4), mark: 'Marked' }
      ]
    })
    expect(reviewHistory(a).map((e) => [e.kind, e.text])).toEqual([
      ['created', ''],
      ['reply', 'Fix it'],
      ['status', 'Accepted'],
      ['checked', ''],
      ['modified', '']
    ])
  })
})

describe('comment list: checked and subject', () => {
  const list = [
    mk({ subject: 'Drainage', replies: [{ id: 1, author: 'A', text: '', date: when(1), mark: 'Marked' }] }),
    mk({ subject: 'Drainage' }),
    mk({ subject: 'Kerb' }),
    mk()
  ]
  it('filters on checked and subject', () => {
    expect(filterComments(list, { ...NO_FILTER, checked: 'yes' })).toHaveLength(1)
    expect(filterComments(list, { ...NO_FILTER, checked: 'no' })).toHaveLength(3)
    expect(filterComments(list, { ...NO_FILTER, subject: 'Drainage' })).toHaveLength(2)
    expect(filterComments(list, { ...NO_FILTER, subject: NO_SUBJECT })).toHaveLength(1)
    expect(filterComments(list, { ...NO_FILTER, query: 'kerb' })).toHaveLength(1)
  })
  it('groups and sorts by subject, and groups by checked', () => {
    const groups = groupComments(sortComments(list, 'subject'), 'subject', String)
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['(no subject)', 1],
      ['Drainage', 2],
      ['Kerb', 1]
    ])
    expect(groupComments(list, 'checked', String).map((g) => [g.label, g.items.length])).toEqual([
      ['Checked', 1],
      ['Not checked', 3]
    ])
    expect(subjectsOf(list)).toEqual(['Drainage', 'Kerb'])
  })
})

describe('style sets', () => {
  const presets = [
    { id: 'a', name: 'Red cloud', kind: 'cloud', style: { color: '#e5322d', lineWidth: 2, cloud: 2 } },
    { id: 'b', name: 'Help note', kind: 'note', style: { color: '#ffd400', icon: 'Help' as const } }
  ]
  it('round-trips through a file with fresh ids', () => {
    let n = 0
    const back = parseStyleSet(exportStyleSet(presets), () => `new${n++}`)
    expect(back.map((p) => [p.id, p.name, p.kind, p.style])).toEqual([
      ['new0', 'Red cloud', 'cloud', presets[0].style],
      ['new1', 'Help note', 'note', presets[1].style]
    ])
  })
  it('drops settings and entries that are not valid', () => {
    expect(sanitiseStyle({ color: 'red', lineWidth: 9999, opacity: 0.5, icon: 'Bomb', blend: 'Multiply', dash: 'dashed', cloud: 7 })).toEqual({ opacity: 0.5, blend: 'Multiply', dash: 'dashed' })
    const text = JSON.stringify({ styles: [{ name: 'Ok', kind: 'note', style: { color: '#000000' } }, { name: '', kind: 'note' }, { name: 'Odd tool', kind: 'rocket' }] })
    expect(parseStyleSet(text, () => 'x').map((p) => p.name)).toEqual(['Ok'])
    expect(() => parseStyleSet('nope', () => 'x')).toThrow('not a style set')
    expect(() => parseStyleSet('{"styles":[]}', () => 'x')).toThrow('no styles')
  })
  it('replaces a style with the same name and tool, keeping its id', () => {
    const merged = mergeStyleSets(presets, [
      { id: 'z', name: 'Red cloud', kind: 'cloud', style: { color: '#000000' } },
      { id: 'y', name: 'New', kind: 'note', style: {} }
    ])
    expect(merged.map((p) => [p.id, p.name])).toEqual([
      ['a', 'Red cloud'],
      ['b', 'Help note'],
      ['y', 'New']
    ])
    expect(merged[0].style.color).toBe('#000000')
  })
})

describe('scale lists', () => {
  const scales = [
    { id: '1', name: 'Site 1:500', ratio: 500, unit: 'm', decimals: 1 },
    { id: '2', name: 'Detail', ratio: 20, unit: 'ft-in', fraction: 16 }
  ]
  it('round-trips and skips entries that make no sense', () => {
    let n = 0
    const back = parseScaleList(exportScaleList(scales), () => `n${n++}`)
    expect(back).toEqual([
      { id: 'n0', name: 'Site 1:500', ratio: 500, unit: 'm', decimals: 1 },
      { id: 'n1', name: 'Detail', ratio: 20, unit: 'ft-in', fraction: 16 }
    ])
    const text = JSON.stringify({ scales: [{ name: 'Bad unit', ratio: 100, unit: 'parsec' }, { name: 'Zero', ratio: 0, unit: 'm' }, { name: 'Metric fraction', ratio: 100, unit: 'm', fraction: 8 }] })
    expect(parseScaleList(text, () => 'x')).toEqual([{ id: 'x', name: 'Metric fraction', ratio: 100, unit: 'm' }])
    expect(() => parseScaleList('[]', () => 'x')).toThrow('no scales')
  })
  it('reads a file saved with a byte order mark', () => {
    expect(parseScaleList('\uFEFF' + exportScaleList(scales), () => 'x')).toHaveLength(2)
    expect(parseStyleSet('\uFEFF' + exportStyleSet([{ id: 'a', name: 'S', kind: 'note', style: {} }]), () => 'x')).toHaveLength(1)
  })
  it('replaces a scale with the same name', () => {
    const merged = mergeScaleLists(scales, [{ id: 'q', name: 'Detail', ratio: 10, unit: 'mm' }])
    expect(merged.map((s) => [s.id, s.name, s.ratio])).toEqual([
      ['1', 'Site 1:500', 500],
      ['2', 'Detail', 10]
    ])
  })
})

describe('angles', () => {
  it('measures the angle at the middle point', () => {
    expect(angleAt({ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90)
    expect(angleAt({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(45)
    expect(angleAt({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(180)
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(0)
  })
  it('formats degrees with one decimal place', () => {
    expect(formatAngle(37.46)).toBe('37.5°')
    expect(formatAngle(90)).toBe('90.0°')
    expect(angleLabel([{ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('90.0°')
    expect(angleLabel([{ x: 0, y: 0 }])).toBe('')
  })
  it('puts the label inside the opening, along the bisector', () => {
    const at = measureLabelAt('angle', [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }])
    expect(at.x).toBeCloseTo(at.y)
    expect(at.x).toBeGreaterThan(10)
  })
  it('lists angles but does not total them', () => {
    const a = mk({ kind: 'polyline', points: [[{ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }]], measure: { kind: 'angle', factor: 1, unit: '°', label: '90.0°', name: 'Corner' } })
    const rows = measureRows([a], null)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'angle', unit: '°', result: '90.0°', label: 'Corner' })
    expect(rows[0].value).toBeCloseTo(90)
    expect(measureTotals(rows)).toEqual([])
    expect(measureCsv(rows)).toContain('"Angle","Corner","90","°","90.0°"')
  })
})

describe('step constraint', () => {
  it('snaps a line to 15 or 45 degree steps and keeps its length', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 100, y: 20 } // about 11.3 degrees
    const s15 = constrainToStep(from, to, 15)
    expect(Math.atan2(s15.y, s15.x) * (180 / Math.PI)).toBeCloseTo(15)
    expect(Math.hypot(s15.x, s15.y)).toBeCloseTo(Math.hypot(100, 20))
    const s45 = constrainToStep(from, to, 45)
    expect(s45.y).toBeCloseTo(0)
  })
})

describe('measurement captions', () => {
  it('puts the label in front of the result, except for a count', () => {
    expect(measureCaption({ kind: 'distance', label: '12.5 m' })).toBe('12.5 m')
    expect(measureCaption({ kind: 'distance', label: '12.5 m', name: ' Kerb ' })).toBe('Kerb: 12.5 m')
    expect(measureCaption({ kind: 'count', label: 'Pit', name: 'x' })).toBe('Pit')
  })
})

describe('note glyphs', () => {
  it('has a picture for every icon, and converts paths to PDF operators inside the box', () => {
    for (const i of NOTE_ICONS) {
      const g = noteGlyph(i)
      expect(g.strokes.length + g.fills.length + (g.text ? 1 : 0)).toBeGreaterThan(0)
    }
    expect(glyphPathOps('M.5 .5 L1 1 Z', { x: 100, y: 200, w: 20, h: 40 })).toBe('110 220 m 120 240 l h')
    expect(glyphPathOps('M0 0 C.5 0 1 .5 1 1', { x: 0, y: 0, w: 10, h: 10 })).toBe('0 0 m 5 0 10 5 10 10 c')
  })
})

describe('text correction', () => {
  let n = 500
  const base = { author: 'Author One', now: when(1), newId: () => n++ }
  const make = (page: number, rects: Annot['rects']): Annot => mk({ kind: 'highlight', page, rects })
  const parts = [
    { page: 0, rects: [{ x: 1, y: 1, w: 50, h: 10 }] },
    { page: 1, rects: [{ x: 1, y: 1, w: 30, h: 10 }, { x: 1, y: 12, w: 20, h: 10 }] }
  ]
  it('strikes out every part, with the replacement and the one thread on the last', () => {
    const out = buildCorrection(parts, { ...base, replacement: ' new text ', comment: ' Wrong spec ', make })
    expect(out.map((a) => a.kind)).toEqual(['strikeout', 'strikeout'])
    expect(out[0].replace).toBeUndefined()
    expect(out[0].replies).toBeUndefined()
    expect(out[1]).toMatchObject({ replace: true, text: 'new text' })
    expect(out[1].replies).toMatchObject([{ author: 'Author One', text: 'Wrong spec' }])
  })
  it('is a plain deletion without replacement text, and nothing for an empty selection', () => {
    const out = buildCorrection(parts, { ...base, replacement: '  ', comment: '', make })
    expect(out[1].replace).toBeUndefined()
    expect(out[1].replies).toBeUndefined()
    expect(buildCorrection([{ page: 0, rects: [] }], { ...base, replacement: 'x', comment: '', make })).toEqual([])
  })
})

describe('annotation clipboard', () => {
  const pages = [
    { width: 600, height: 800 },
    { width: 600, height: 800 },
    { width: 300, height: 300 }
  ]
  let n = 9000
  const opts = (page: number, nudge = 12) => ({ page, pages, nudge, newId: () => n++, author: 'Author One', now: when(2) })
  it('nudges copies pasted onto their own page, and keeps the position on another', () => {
    const a = mk({ page: 0, rects: [{ x: 100, y: 100, w: 22, h: 22 }], replies: [{ id: 1, author: 'B', text: 'r', date: when(1) }], origin: { index: 0, subtype: 1, rect: [0, 0, 1, 1] } })
    const [same] = pasteAnnots([a], opts(0))
    expect(same.rects[0]).toMatchObject({ x: 112, y: 112 })
    expect(same.origin).toBeUndefined()
    expect(same.replies).toBeUndefined()
    expect(same.id).not.toBe(a.id)
    expect(same.author).toBe('Author One')
    const [other] = pasteAnnots([a], opts(1))
    expect(other.page).toBe(1)
    expect(other.rects[0]).toMatchObject({ x: 100, y: 100 })
  })
  it('keeps the distance between copies, and their page offsets', () => {
    const a = mk({ page: 0, rects: [{ x: 50, y: 50, w: 20, h: 20 }] })
    const b = mk({ page: 1, rects: [{ x: 200, y: 300, w: 20, h: 20 }] })
    const [pa, pb] = pasteAnnots([a, b], opts(1))
    expect([pa.page, pb.page]).toEqual([1, 2])
    expect(pb.rects[0]).toMatchObject({ x: 200, y: 280 }) // clamped inside the small page
    expect(pa.rects[0]).toMatchObject({ x: 50, y: 50 })
  })
  it('keeps a copy inside its page and leaves out annotations from other tools', () => {
    const a = mk({ page: 0, rects: [{ x: 590, y: 790, w: 8, h: 8 }] })
    expect(pasteAnnots([a], opts(0))[0].rects[0]).toMatchObject({ x: 592, y: 792 })
    expect(copyable([a, mk({ kind: 'foreign' })])).toEqual([a])
    expect(pasteAnnots([mk({ kind: 'foreign' })], opts(0))).toEqual([])
  })
})
