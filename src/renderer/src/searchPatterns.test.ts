import { describe, expect, it } from 'vitest'
import type { PageText } from './pdfiumRaw'
import { abnValid, acnValid, buildRegex, contextOf, findInString, findPattern, groupByPage, luhn, presetById, queryError, searchBookmarks, searchComments, type SearchOpts } from './searchPatterns'

const base: SearchOpts = { regex: false, matchCase: false, wholeWord: false }
const text = (s: string): PageText => ({
  text: s,
  boxes: new Float32Array(s.length * 4),
  charOf: Int32Array.from({ length: s.length }, (_, i) => i)
})
const preset = (id: string, s: string) => {
  const p = presetById(id)!
  return findInString(s, p.pattern, {
    ...base,
    regex: true,
    validate: p.validate
  }).map((m) => s.slice(m.from, m.end))
}

describe('plain and regular expression search', () => {
  it('matches case and whole words', () => {
    expect(findInString('Cat cat concat', 'cat', base)).toHaveLength(3)
    expect(findInString('Cat cat concat', 'cat', { ...base, matchCase: true })).toHaveLength(2)
    expect(findInString('Cat cat concat', 'cat', { ...base, wholeWord: true })).toHaveLength(2)
  })
  it('treats the query literally unless regex is on', () => {
    expect(findInString('a.c abc', 'a.c', base)).toHaveLength(1)
    expect(findInString('a.c abc', 'a.c', { ...base, regex: true })).toHaveLength(2)
  })
  it('applies whole word to a regular expression with alternatives', () => {
    expect(
      findInString('on one only', 'on|one', {
        ...base,
        regex: true,
        wholeWord: true
      }).map((m) => m.from)
    ).toEqual([0, 3])
  })
  it('reports an invalid pattern and finds nothing', () => {
    expect(queryError('(', { ...base, regex: true })).toBeTruthy()
    expect('error' in buildRegex('(', { ...base, regex: true })).toBe(true)
    expect(findInString('(', '(', { ...base, regex: true })).toEqual([])
    expect(queryError('(', base)).toBeNull()
  })
  it('skips empty matches without looping', () => {
    expect(findInString('abc', 'x*', { ...base, regex: true })).toEqual([])
  })
  it('maps a page match to character indices', () => {
    const pt: PageText = {
      text: 'ab  cd',
      boxes: new Float32Array(0),
      charOf: Int32Array.from([0, 1, 2, 3, 4, 5])
    }
    expect(findPattern(pt, 2, 'cd', base)).toEqual([{ page: 2, from: 4, to: 5 }])
  })
  it('gives context on one line', () => {
    const pt = text('before\nthe NEEDLE here\nafter')
    const m = findPattern(pt, 0, 'needle', base)[0]
    expect(contextOf(pt, m, 8)).toEqual({
      before: 'ore the ',
      match: 'NEEDLE',
      after: ' here af'
    })
  })
})

describe('check digits', () => {
  it('knows a valid card number and an invalid one', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true)
    expect(luhn('4111 1111 1111 1112')).toBe(false)
  })
  it('knows a valid ABN and ACN', () => {
    expect(abnValid('51 824 753 556')).toBe(true)
    expect(abnValid('51 824 753 557')).toBe(false)
    expect(acnValid('000 000 019')).toBe(true)
    expect(acnValid('000 000 018')).toBe(false)
  })
})

describe('presets', () => {
  it('finds Australian phone numbers', () => {
    const found = preset('phone', 'Call 07 3123 4567, 0412 345 678, +61 7 3123 4567 or 1300 123 456. Not 12345.')
    expect(found).toEqual(['07 3123 4567', '0412 345 678', '+61 7 3123 4567', '1300 123 456'])
  })
  it('finds e-mail addresses', () => {
    expect(preset('email', 'Write to a.b+c@example.com.au or x@y.io.')).toEqual(['a.b+c@example.com.au', 'x@y.io'])
  })
  it('finds dates in several forms', () => {
    expect(preset('date', 'On 17/10/2026, 2026-10-17 and 3 March 2026 but not 1234567')).toEqual(['17/10/2026', '2026-10-17', '3 March 2026'])
  })
  it('keeps only ABNs with a good check digit', () => {
    expect(preset('abn', 'ABN 51 824 753 556 and 51 824 753 557')).toEqual(['51 824 753 556'])
  })
  it('keeps only card-like numbers that pass Luhn', () => {
    expect(preset('card', 'Card 4111 1111 1111 1111, ref 4111 1111 1111 1112')).toEqual(['4111 1111 1111 1111'])
  })
  it('finds TFN-like groups', () => {
    expect(preset('tfn', 'TFN 123 456 782 and 1234 5678')).toEqual(['123 456 782'])
  })
  it('finds a valid match hidden inside a rejected one', () => {
    // The 16 digits fail Luhn, but the 13 digits starting one place later pass.
    const inner = '4222222222222'
    expect(luhn(inner)).toBe(true)
    expect(preset('card', `9${inner}`).length).toBeLessThanOrEqual(1)
  })
})

describe('comments, bookmarks, grouping', () => {
  it('searches comments and their replies, not links', () => {
    const hits = searchComments(
      [
        { id: 1, page: 0, kind: 'note', text: 'Check the Culvert level' },
        {
          id: 2,
          page: 3,
          kind: 'note',
          text: 'ok',
          replies: [{ text: 'culvert is fine' }]
        },
        { id: 3, page: 1, kind: 'link', text: 'culvert' },
        { id: 4, page: 1, kind: 'note', text: 'nothing' }
      ],
      'culvert',
      base
    )
    expect(hits.map((h) => [h.annotId, h.page, h.match])).toEqual([
      [1, 0, 'Culvert'],
      [2, 3, 'culvert']
    ])
  })
  it('searches bookmark titles with their trail', () => {
    const hits = searchBookmarks(
      [
        {
          title: 'Part A',
          page: 0,
          children: [{ title: 'Drainage scope', page: 4, children: [] }]
        }
      ],
      'drain',
      base
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      kind: 'bookmark',
      page: 4,
      trail: 'Part A > Drainage scope'
    })
  })
  it('groups by page in order', () => {
    expect(
      groupByPage([
        { page: 2, n: 1 },
        { page: 0, n: 2 },
        { page: 2, n: 3 }
      ]).map((g) => [g.page, g.items.length])
    ).toEqual([
      [0, 1],
      [2, 2]
    ])
  })
})

describe('collectMatches', () => {
  it('combines patterns over pages and drops overlaps', async () => {
    const { collectMatches } = await import('./searchPatterns')
    const pages = [text('mail a@b.com on 17/10/2026'), text('nothing'), text('x@y.io')]
    const specs = [
      { query: presetById('email')!.pattern, opts: { ...base, regex: true } },
      { query: presetById('date')!.pattern, opts: { ...base, regex: true } },
      { query: 'a@b', opts: base }
    ]
    const got = await collectMatches(async (p) => pages[p], pages.length, specs)
    expect(got.map((g) => [g.page, g.pt.text.slice(g.m.from, g.m.to + 1)])).toEqual([
      [0, 'a@b.com'],
      [0, '17/10/2026'],
      [2, 'x@y.io']
    ])
  })
})
