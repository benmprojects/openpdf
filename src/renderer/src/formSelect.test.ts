import { describe, expect, it } from 'vitest'
import { moveWidgets, selectedFieldNames, widgetsInRect, type WidgetBox } from './formArrange'

const box = (name: string, x: number, y: number, w: number, h: number, page = 0, widget = 0): WidgetBox => ({ name, widget, page, rect: { x, y, w, h } })
const boxes = [box('a', 10, 20, 100, 20), box('b', 50, 60, 80, 30), box('c', 200, 130, 40, 10), box('d', 10, 20, 30, 30, 1)]
const refs = (...n: string[]) => n.map((name) => ({ name, widget: 0 }))

describe('moving a selection as a group', () => {
  it('moves every selected widget on the page by the same offset', () => {
    const out = moveWidgets(boxes, refs('a', 'b', 'd'), 0, 15, -5)
    expect(out.map((b) => [b.name, b.rect.x, b.rect.y])).toEqual([['a', 25, 15], ['b', 65, 55]])
  })

  it('keeps the whole group on the page', () => {
    const out = moveWidgets(boxes, refs('a', 'c'), 0, 1000, 1000, { width: 300, height: 200 })
    expect(out.find((b) => b.name === 'c')!.rect.x + 40).toBe(300)
    expect(out.find((b) => b.name === 'c')!.rect.y + 10).toBe(200)
    // The relative positions are unchanged.
    expect(out.find((b) => b.name === 'c')!.rect.x - out.find((b) => b.name === 'a')!.rect.x).toBe(190)
    const back = moveWidgets(boxes, refs('a', 'c'), 0, -1000, -1000, { width: 300, height: 200 })
    expect(back.find((b) => b.name === 'a')!.rect.x).toBe(0)
    expect(back.find((b) => b.name === 'a')!.rect.y).toBe(0)
  })

  it('reports nothing when the group cannot move', () => {
    expect(moveWidgets(boxes, refs('a'), 0, 0, 0)).toEqual([])
    expect(moveWidgets(boxes, refs('a'), 3, 5, 5)).toEqual([])
  })
})

describe('dragging a box to select', () => {
  it('picks the widgets the box touches on that page', () => {
    expect(widgetsInRect(boxes, 0, { x: 0, y: 0, w: 120, h: 70 }).map((r) => r.name)).toEqual(['a', 'b'])
    expect(widgetsInRect(boxes, 1, { x: 0, y: 0, w: 120, h: 70 }).map((r) => r.name)).toEqual(['d'])
    expect(widgetsInRect(boxes, 0, { x: 300, y: 300, w: 10, h: 10 })).toEqual([])
  })
  it('ignores a click without a drag', () => {
    expect(widgetsInRect(boxes, 0, { x: 20, y: 25, w: 0, h: 0 })).toEqual([])
  })
  it('lists each field once', () => {
    expect(selectedFieldNames([{ name: 'x', widget: 0 }, { name: 'x', widget: 1 }, { name: 'y', widget: 0 }])).toEqual(['x', 'y'])
  })
})
