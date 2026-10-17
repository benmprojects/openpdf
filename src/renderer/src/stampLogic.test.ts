import { describe, expect, it } from 'vitest'
import {
  BUILTIN_STAMPS,
  CAT_MINE,
  categoriesOf,
  expandFields,
  expandStamp,
  fitAspect,
  formatDate,
  formatNumber,
  formatTime,
  parseCollection,
  parseMeta,
  pushRecent,
  rotatedBounds,
  searchStamps,
  serialiseCollection,
  takeNumbers,
  tidyLine,
  uniqueName,
  usesNumber,
  type StampDef
} from './stampLogic'

const when = new Date(2026, 9, 5, 14, 7) // 05/10/2026 14:07
const ctx = { author: 'Ben Myers', now: when }

describe('fields', () => {
  it('formats dates and times', () => {
    expect(formatDate('DD/MM/YYYY', when)).toBe('05/10/2026')
    expect(formatDate('D MMM YYYY', when)).toBe('5 Oct 2026')
    expect(formatDate('D MMMM YYYY', when)).toBe('5 October 2026')
    expect(formatDate('YYYY-MM-DD', when)).toBe('2026-10-05')
    expect(formatTime('HH:mm', when)).toBe('14:07')
    expect(formatTime('h:mm a', when)).toBe('2:07 pm')
    expect(formatTime('h:mm a', new Date(2026, 0, 1, 0, 5))).toBe('12:05 am')
  })
  it('fills fields and keeps unknown ones', () => {
    expect(expandFields('{date} {time} {author}', ctx)).toBe('05/10/2026 14:07 Ben Myers')
    expect(expandFields('Issued {date:D MMM YYYY} at {TIME:h:mm a}', ctx)).toBe('Issued 5 Oct 2026 at 2:07 pm')
    expect(expandFields('{other} {number}', ctx)).toBe('{other} {number}')
    expect(expandFields('No {number}', { ...ctx, number: 'RFI-007' })).toBe('No RFI-007')
  })
  it('tidies a line when the author is empty', () => {
    expect(expandStamp({ title: 'A', detail: '{author}, {date}' }, { author: '', now: when }).detail).toBe('05/10/2026')
    expect(tidyLine('  a   b ,c')).toBe('a b,c')
  })
  it('knows when a number is used', () => {
    expect(usesNumber('X', 'No. {number}')).toBe(true)
    expect(usesNumber('X', '{date}')).toBe(false)
  })
})

describe('numbering', () => {
  it('pads and prefixes', () => {
    expect(formatNumber('RFI-', 7, 4)).toBe('RFI-0007')
    expect(formatNumber(undefined, 12)).toBe('12')
  })
  it('increments per use without changing the input', () => {
    const def = { id: 'a', numberPrefix: 'T-', numberDigits: 3, numberStart: 5 }
    const c0 = {}
    const one = takeNumbers(c0, def)
    expect(one.numbers).toEqual(['T-005'])
    expect(c0).toEqual({})
    const more = takeNumbers(one.counters, def, 3)
    expect(more.numbers).toEqual(['T-006', 'T-007', 'T-008'])
    expect(more.counters.a).toBe(9)
    expect(takeNumbers({}, { id: 'b' }).numbers).toEqual(['1'])
  })
})

describe('palette', () => {
  it('has the required built-in stamps with unique ids', () => {
    const ids = BUILTIN_STAMPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const titles = BUILTIN_STAMPS.map((s) => s.title)
    for (const t of ['APPROVED', 'NOT APPROVED', 'VOID', 'RECEIVED', 'APPROVED FOR CONSTRUCTION', 'AS BUILT', 'SUPERSEDED', 'FOR INFORMATION ONLY', 'CHECKED', 'SIGN HERE', 'INITIAL HERE', 'WITNESS']) {
      expect(titles).toContain(t)
    }
  })
  it('searches by every word', () => {
    expect(searchStamps(BUILTIN_STAMPS, 'not for').map((s) => s.title)).toEqual(['NOT FOR CONSTRUCTION'])
    expect(searchStamps(BUILTIN_STAMPS, '  ')).toBe(BUILTIN_STAMPS)
    expect(searchStamps(BUILTIN_STAMPS, 'sign here').length).toBeGreaterThan(0)
  })
  it('lists categories with the user\'s own before My stamps', () => {
    const mine: StampDef = { id: 'x', name: 'x', category: 'Roads', kind: 'text', title: 'X', detail: '', color: '#000000' }
    expect(categoriesOf([...BUILTIN_STAMPS, mine])).toEqual(['Standard business', 'Construction', 'Sign here', 'Roads', CAT_MINE])
  })
  it('keeps recents unique, newest first and capped', () => {
    let r: string[] = []
    for (let i = 0; i < 12; i++) r = pushRecent(r, `s${i}`)
    expect(r).toHaveLength(8)
    expect(pushRecent(r, 's5')[0]).toBe('s5')
    expect(pushRecent(r, 's5').filter((x) => x === 's5')).toHaveLength(1)
  })
  it('makes names unique', () => {
    expect(uniqueName('A', ['A', 'A 2'])).toBe('A 3')
    expect(uniqueName(' ', [])).toBe('Stamp')
  })
})

describe('geometry', () => {
  it('bounds a rotated box', () => {
    const b = rotatedBounds({ x: 0, y: 0, w: 100, h: 40 }, 90)
    expect(b.w).toBeCloseTo(40)
    expect(b.h).toBeCloseTo(100)
    expect(b.x + b.w / 2).toBeCloseTo(50)
    expect(rotatedBounds({ x: 0, y: 0, w: 10, h: 10 }, 0)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
  it('fits a shape inside a dragged box', () => {
    expect(fitAspect({ w: 200, h: 50 }, 2)).toEqual({ w: 100, h: 50 })
    expect(fitAspect({ w: 100, h: 200 }, 2)).toEqual({ w: 100, h: 50 })
  })
})

describe('collection file', () => {
  const text: StampDef = { id: 't1', name: 'RFI', category: 'Roads', kind: 'text', title: 'RFI {number}', detail: '{date}', color: '#1f5fd1', numberPrefix: 'RFI-', numberDigits: 4, numberStart: 3 }
  const png = 'data:image/png;base64,iVBORw0KGgo='
  const image: StampDef = { id: 'i1', name: 'Seal', category: CAT_MINE, kind: 'image', title: '', detail: '', color: '#000000', image: { dataUrl: png, width: 10, height: 20 } }
  it('round trips and leaves out built-ins and ids', () => {
    const json = serialiseCollection([BUILTIN_STAMPS[0], text, image])
    expect(json).not.toContain('"id"')
    const back = parseCollection(json)
    expect(back.skipped).toBe(0)
    expect(back.stamps).toHaveLength(2)
    expect(back.stamps[0]).toMatchObject({ name: 'RFI', category: 'Roads', title: 'RFI {number}', numberPrefix: 'RFI-', numberDigits: 4, numberStart: 3 })
    expect(back.stamps[1].image).toEqual({ dataUrl: png, width: 10, height: 20 })
  })
  it('refuses other files and skips bad stamps', () => {
    expect(() => parseCollection('nope')).toThrow(/not a stamp collection/)
    expect(() => parseCollection('{"format":"x"}')).toThrow(/not an OpenPDF/)
    expect(() => parseCollection('{"format":"openpdf-stamps","version":2,"stamps":[]}')).toThrow(/newer/)
    const bad = JSON.stringify({
      format: 'openpdf-stamps',
      version: 1,
      stamps: [
        { name: 'ok', kind: 'text', title: 'OK', color: 'red' },
        { name: '', kind: 'text', title: 'x' },
        { name: 'img', kind: 'image', image: { dataUrl: 'data:text/html;base64,AAAA', width: 1, height: 1 } },
        { name: 'img2', kind: 'image', image: { dataUrl: 'javascript:alert(1)', width: 1, height: 1 } }
      ]
    })
    const r = parseCollection(bad)
    expect(r.stamps).toHaveLength(1)
    expect(r.stamps[0].color).toBe('#1f5fd1')
    expect(r.stamps[0].category).toBe(CAT_MINE)
    expect(r.skipped).toBe(3)
  })
})

describe('saved settings', () => {
  it('ignores malformed data', () => {
    expect(parseMeta(null)).toEqual({ texts: [], recent: [], counters: {} })
    expect(parseMeta('{{')).toEqual({ texts: [], recent: [], counters: {} })
    const m = parseMeta(JSON.stringify({ texts: [{ id: 'a', kind: 'text', name: 'A', title: 'A', color: 'bad' }, { id: 5 }], recent: ['a', 3], counters: { a: 4, b: 'x', c: -1 } }))
    expect(m.texts).toHaveLength(1)
    expect(m.texts[0].category).toBe(CAT_MINE)
    expect(m.texts[0].color).toBe('#1f5fd1')
    expect(m.recent).toEqual(['a'])
    expect(m.counters).toEqual({ a: 4 })
  })
})
