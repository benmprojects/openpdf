import { describe, expect, it } from 'vitest'
import type { Annot } from './annotations'
import { deletable, filterComments, flatten, groupComments, NO_FILTER, sortComments, stepComment } from './commentList'

let id = 1
const make = (extra: Partial<Annot>): Annot => ({ id: id++, page: 0, kind: 'note', color: '#ffd400', rects: [{ x: 10, y: 10, w: 20, h: 20 }], text: '', fontSize: 12, lineWidth: 1, ...extra })

const list: Annot[] = [
  make({ page: 2, kind: 'rectangle', color: '#e5322d', author: 'Sam', text: 'Kerb', created: '2026-10-02T01:00:00.000Z' }),
  make({ page: 0, kind: 'note', color: '#ffd400', author: 'Alex', text: 'Pit lid', created: '2026-10-03T01:00:00.000Z', replies: [{ id: 900, author: 'Sam', text: '', date: '2026-10-04T00:00:00.000Z', state: 'Accepted' }] }),
  make({ page: 0, kind: 'highlight', color: '#ffd400', author: 'Sam', text: 'Pipe', created: '2026-10-03T05:00:00.000Z', rects: [{ x: 10, y: 5, w: 20, h: 20 }] }),
  make({ page: 1, kind: 'note', color: '#6ec1ff', text: 'No author', flags: 4 | 128 })
]
const pageName = (p: number) => `Page ${p + 1}`

describe('filterComments', () => {
  it('filters by type, author, status, colour and text (including replies)', () => {
    expect(filterComments(list, { ...NO_FILTER, kind: 'note' })).toHaveLength(2)
    expect(filterComments(list, { ...NO_FILTER, author: 'Sam' })).toHaveLength(2)
    expect(filterComments(list, { ...NO_FILTER, status: 'Accepted' }).map((a) => a.text)).toEqual(['Pit lid'])
    expect(filterComments(list, { ...NO_FILTER, status: 'None' })).toHaveLength(3)
    expect(filterComments(list, { ...NO_FILTER, colour: '#FFD400' })).toHaveLength(2)
    expect(filterComments(list, { ...NO_FILTER, query: 'KERB' })).toHaveLength(1)
    expect(filterComments(list, { ...NO_FILTER, author: '' })).toHaveLength(4)
  })
})

describe('sortComments', () => {
  it('sorts by page then position, newest first, author, type and status', () => {
    expect(sortComments(list, 'page').map((a) => a.text)).toEqual(['Pipe', 'Pit lid', 'No author', 'Kerb'])
    expect(sortComments(list, 'date').map((a) => a.text)[0]).toBe('Pipe')
    expect(sortComments(list, 'author').map((a) => a.author)).toEqual([undefined, 'Alex', 'Sam', 'Sam'])
    expect(sortComments(list, 'type').map((a) => a.kind)[0]).toBe('Highlight'.toLowerCase())
    expect(sortComments(list, 'status')[3].text).toBe('Pit lid') // Accepted comes after No status
  })
  it('does not change the list it is given', () => {
    const copy = [...list]
    sortComments(list, 'author')
    expect(list).toEqual(copy)
  })
})

describe('groupComments', () => {
  it('does not group when asked for none', () => {
    expect(groupComments(list, 'none', pageName)).toHaveLength(1)
  })
  it('groups by page in page order', () => {
    const g = groupComments(sortComments(list, 'page'), 'page', pageName)
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Page 1', 2], ['Page 2', 1], ['Page 3', 1]])
  })
  it('groups by author, colour, type, status and day', () => {
    expect(groupComments(list, 'author', pageName).map((g) => g.label)).toEqual(['(no author)', 'Alex', 'Sam'])
    expect(groupComments(list, 'colour', pageName).map((g) => g.items.length).sort()).toEqual([1, 1, 2])
    expect(groupComments(list, 'type', pageName).map((g) => g.label)).toEqual(['Highlight', 'Note', 'Rectangle'])
    expect(groupComments(list, 'status', pageName).map((g) => g.label)).toEqual(['No status', 'Accepted'])
    const days = groupComments(list, 'date', pageName)
    expect(days.map((g) => g.key)).toEqual(['2026-10-03', '2026-10-02', ''])
    expect(days[0].items).toHaveLength(2)
  })
})

describe('stepComment', () => {
  const order = [5, 6, 7]
  it('steps and wraps both ways', () => {
    expect(stepComment(order, 5, 1)).toBe(6)
    expect(stepComment(order, 7, 1)).toBe(5)
    expect(stepComment(order, 5, -1)).toBe(7)
  })
  it('starts at the first or last when nothing is current', () => {
    expect(stepComment(order, null, 1)).toBe(5)
    expect(stepComment(order, null, -1)).toBe(7)
    expect(stepComment(order, 99, 1)).toBe(5)
    expect(stepComment([], null, 1)).toBeNull()
  })
  it('follows the grouped order', () => {
    const flat = flatten(groupComments(list, 'author', pageName)).map((a) => a.id)
    expect(stepComment(flat, flat[0], 1)).toBe(flat[1])
  })
})

describe('deletable', () => {
  it('leaves out locked comments', () => {
    expect(deletable(list)).toHaveLength(3)
  })
})
