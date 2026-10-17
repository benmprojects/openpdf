import { describe, expect, it } from 'vitest'
import { arrangeWidgets, boxesOf, duplicateSpecs, duplicateTargets, uniqueName, type WidgetBox } from './formArrange'
import type { FormField } from './forms'

const box = (name: string, x: number, y: number, w: number, h: number, page = 0): WidgetBox => ({ name, widget: 0, page, rect: { x, y, w, h } })
const ref = (name: string) => ({ name, widget: 0 })

describe('arranging fields', () => {
  const boxes = [box('a', 10, 20, 100, 20), box('b', 50, 60, 80, 30), box('c', 200, 130, 40, 10)]

  it('aligns left, right and centre to the outer box of the selection', () => {
    const left = arrangeWidgets(boxes, boxes.map((b) => ref(b.name)), { kind: 'align', mode: 'left' })
    expect(left.map((b) => [b.name, b.rect.x])).toEqual([['b', 10], ['c', 10]])
    const right = arrangeWidgets(boxes, boxes.map((b) => ref(b.name)), { kind: 'align', mode: 'right' })
    expect(right.find((b) => b.name === 'a')!.rect.x).toBe(140)
    const centre = arrangeWidgets(boxes, boxes.map((b) => ref(b.name)), { kind: 'align', mode: 'centre' })
    expect(centre.find((b) => b.name === 'c')!.rect.x).toBe(125 - 20)
  })

  it('aligns top, middle and bottom', () => {
    const top = arrangeWidgets(boxes, boxes.map((b) => ref(b.name)), { kind: 'align', mode: 'top' })
    expect(top.map((b) => b.rect.y)).toEqual([20, 20])
    const bottom = arrangeWidgets(boxes, boxes.map((b) => ref(b.name)), { kind: 'align', mode: 'bottom' })
    expect(bottom.find((b) => b.name === 'a')!.rect.y).toBe(120)
  })

  it('leaves fields that are not selected, and fields on other pages, alone', () => {
    const mixed = [...boxes, box('d', 5, 5, 10, 10, 1)]
    const r = arrangeWidgets(mixed, [ref('a'), ref('b'), ref('d')], { kind: 'align', mode: 'left' })
    expect(r.map((b) => b.name)).toEqual(['b'])
  })

  it('distributes three fields with equal gaps', () => {
    const r = arrangeWidgets(boxes, boxes.map((b) => ref(b.name)), { kind: 'distribute', axis: 'horizontal' })
    // Span 10 to 240 = 230, widths 220 in total... gap = (230 - 220) / 2 = 5
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe('b')
    expect(r[0].rect.x).toBe(115)
  })

  it('does nothing for fewer than three when distributing', () => {
    expect(arrangeWidgets(boxes, [ref('a'), ref('b')], { kind: 'distribute', axis: 'vertical' })).toEqual([])
  })

  it('matches width, height or both to the primary field', () => {
    const sel = boxes.map((b) => ref(b.name))
    const w = arrangeWidgets(boxes, sel, { kind: 'match', dim: 'width', primary: ref('a') })
    expect(w.map((b) => [b.name, b.rect.w, b.rect.h])).toEqual([['b', 100, 30], ['c', 100, 10]])
    const h = arrangeWidgets(boxes, sel, { kind: 'match', dim: 'height', primary: ref('b') })
    expect(h.map((b) => [b.name, b.rect.w, b.rect.h])).toEqual([['a', 100, 30], ['c', 40, 30]])
    const both = arrangeWidgets(boxes, sel, { kind: 'match', dim: 'both', primary: ref('a') })
    expect(both.every((b) => b.rect.w === 100 && b.rect.h === 20)).toBe(true)
  })
})

describe('duplicating fields', () => {
  const field: FormField = {
    name: 'site_name',
    type: 'text',
    value: 'Depot',
    initial: 'Depot',
    readOnly: false,
    required: true,
    align: 1,
    tooltip: 'Site',
    fontSize: 10,
    color: '#112233',
    widgets: [{ page: 0, rect: { x: 50, y: 60, w: 120, h: 20 }, order: 0, tabs: '', border: '#000000' }]
  }

  it('makes unique names', () => {
    const taken = new Set(['site_name', 'site_name_2'])
    expect(uniqueName('site_name', taken)).toBe('site_name_3')
    expect(uniqueName('site_name_3', taken)).toBe('site_name_4')
  })

  it('copies to other pages at the same place, and not onto the source page', () => {
    const t = duplicateTargets({ name: 'site_name', widget: 0, page: 0, rect: field.widgets[0].rect }, { kind: 'pages', pages: [0, 2, 1, 2] })
    expect(t.map((x) => x.page)).toEqual([1, 2])
    expect(t[0].rect).toEqual(field.widgets[0].rect)
  })

  it('copies down the page with an offset', () => {
    const t = duplicateTargets({ name: 'site_name', widget: 0, page: 0, rect: field.widgets[0].rect }, { kind: 'offset', dx: 0, dy: 30, copies: 3 })
    expect(t.map((x) => x.rect.y)).toEqual([90, 120, 150])
  })

  it('writes specs with new names and the same look, without the value', () => {
    const specs = duplicateSpecs(field, 0, [{ page: 1, rect: { x: 50, y: 60, w: 120, h: 20 } }, { page: 2, rect: { x: 50, y: 60, w: 120, h: 20 } }], ['site_name'])
    expect(specs.map((s) => s.name)).toEqual(['site_name_2', 'site_name_3'])
    expect(specs[0]).toMatchObject({ type: 'text', page: 1, required: true, align: 1, fontSize: 10, textColor: '#112233', border: '#000000', background: null })
    expect(specs[0].value).toBeUndefined()
  })

  it('adds a radio copy to the same group with a new choice name', () => {
    const radio: FormField = { ...field, name: 'size', type: 'radio', options: ['Small', 'Large'], widgets: [{ ...field.widgets[0], onValue: 'Small' }] }
    const specs = duplicateSpecs(radio, 0, [{ page: 0, rect: { x: 1, y: 1, w: 10, h: 10 } }], ['size'])
    expect(specs[0].name).toBe('size')
    expect(specs[0].option).toBe('Small_2')
  })

  it('lists widgets that sit on a page', () => {
    const detached: FormField = { ...field, name: 'x', widgets: [{ ...field.widgets[0], page: -1 }] }
    expect(boxesOf([field, detached]).map((b) => b.name)).toEqual(['site_name'])
  })
})
