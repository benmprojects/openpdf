import { PDFArray, PDFDocument, PDFName, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addField, deleteField, moveInTabOrder, placeWidget, setTabOrder, updateField, type FieldSpec } from './formDesign'
import { readForm } from './forms'

async function blank(rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 500])
  if (rotation) page.setRotation(degrees(rotation))
  return doc.save()
}

const spec = (over: Partial<FieldSpec>): FieldSpec => ({ type: 'text', name: 'f', page: 0, rect: { x: 50, y: 50, w: 120, h: 20 }, ...over })
const byName = async (b: Uint8Array) => new Map((await readForm(b)).map((f) => [f.name, f]))

describe('addField', () => {
  it('adds every kind of field with its options, at the box drawn on the page', async () => {
    let b = await blank()
    b = await addField(b, spec({ type: 'text', name: 'name', value: 'Hi', multiline: true, maxLength: 20, align: 1, tooltip: 'Your name', required: true, fontSize: 11 }))
    b = await addField(b, spec({ type: 'checkbox', name: 'ok', value: true, rect: { x: 50, y: 90, w: 14, h: 14 }, readOnly: true }))
    b = await addField(b, spec({ type: 'dropdown', name: 'state', options: ['QLD', 'NSW'], value: 'NSW', rect: { x: 50, y: 120, w: 100, h: 20 } }))
    b = await addField(b, spec({ type: 'list', name: 'tools', options: ['A', 'B', 'C'], multiSelect: true, value: ['A', 'C'], rect: { x: 50, y: 150, w: 100, h: 50 } }))
    b = await addField(b, spec({ type: 'button', name: 'go', caption: 'Go', rect: { x: 50, y: 210, w: 60, h: 22 } }))
    b = await addField(b, spec({ type: 'signature', name: 'sign', rect: { x: 50, y: 240, w: 150, h: 40 } }))
    const f = await byName(b)
    expect([...f.keys()].sort()).toEqual(['go', 'name', 'ok', 'sign', 'state', 'tools'])
    expect(f.get('name')).toMatchObject({ type: 'text', value: 'Hi', multiline: true, maxLength: 20, align: 1, tooltip: 'Your name', required: true, fontSize: 11 })
    expect(f.get('ok')).toMatchObject({ type: 'checkbox', value: true, readOnly: true })
    expect(f.get('state')).toMatchObject({ type: 'dropdown', value: 'NSW', options: ['QLD', 'NSW'] })
    expect(f.get('tools')).toMatchObject({ type: 'list', value: ['A', 'C'], multiSelect: true })
    expect(f.get('go')?.type).toBe('button')
    expect(f.get('go')?.widgets[0].caption).toBe('Go')
    expect(f.get('sign')?.type).toBe('signature')
    // The widget sits where it was drawn (display space, y down).
    expect(f.get('name')!.widgets[0].rect).toMatchObject({ x: 50, y: 50, w: 120, h: 20 })
    expect(f.get('sign')!.widgets[0].rect).toMatchObject({ x: 50, y: 240, w: 150, h: 40 })
  })

  it('draws the box in the right place on a rotated page', async () => {
    const f = await byName(await addField(await blank(90), spec({ rect: { x: 30, y: 40, w: 100, h: 20 } })))
    const r = f.get('f')!.widgets[0].rect
    expect(r.x).toBeCloseTo(30)
    expect(r.y).toBeCloseTo(40)
    expect(r.w).toBeCloseTo(100)
    expect(r.h).toBeCloseTo(20)
  })

  it('groups radio buttons by name and rejects a repeated choice', async () => {
    let b = await blank()
    for (const [i, o] of ['Civil', 'Parks'].entries()) b = await addField(b, spec({ type: 'radio', name: 'trade', option: o, value: 'Parks', rect: { x: 50 + i * 40, y: 50, w: 14, h: 14 } }))
    const f = (await byName(b)).get('trade')!
    expect(f.type).toBe('radio')
    expect(f.options).toEqual(['Civil', 'Parks'])
    expect(f.value).toBe('Parks')
    expect(f.widgets).toHaveLength(2)
    await expect(addField(b, spec({ type: 'radio', name: 'trade', option: 'Civil', rect: { x: 50, y: 80, w: 14, h: 14 } }))).rejects.toThrow(/already has a button/)
  })

  it('refuses bad names, repeated names and boxes that are too small', async () => {
    const b = await addField(await blank(), spec({ name: 'a' }))
    await expect(addField(b, spec({ name: 'a' }))).rejects.toThrow(/already a field called "a"/)
    await expect(addField(b, spec({ name: ' ' }))).rejects.toThrow(/needs a name/)
    await expect(addField(b, spec({ name: 'a.b' }))).rejects.toThrow(/full stop/)
    await expect(addField(b, spec({ name: 'c', rect: { x: 10, y: 10, w: 2, h: 2 } }))).rejects.toThrow(/larger/)
  })

  it('writes the button action', async () => {
    const b = await addField(await blank(), spec({ type: 'button', name: 'reset', caption: 'Clear', action: { kind: 'reset' } }))
    const b2 = await addField(b, spec({ type: 'button', name: 'web', caption: 'Open', action: { kind: 'uri', url: 'https://example.com/' }, rect: { x: 50, y: 90, w: 60, h: 20 } }))
    const b3 = await addField(b2, spec({ type: 'button', name: 'send', caption: 'Send', action: { kind: 'submit', url: 'https://example.com/post', format: 'xfdf' }, rect: { x: 50, y: 120, w: 60, h: 20 } }))
    const f = await byName(b3)
    expect(f.get('reset')?.action).toEqual({ kind: 'reset' })
    expect(f.get('web')?.action).toEqual({ kind: 'uri', url: 'https://example.com/' })
    expect(f.get('send')?.action).toEqual({ kind: 'submit', url: 'https://example.com/post', format: 'xfdf' })
  })
})

describe('updateField', () => {
  it('changes properties, options and the name', async () => {
    let b = await addField(await blank(), spec({ type: 'dropdown', name: 'state', options: ['QLD', 'NSW'] }))
    b = await updateField(b, 'state', { options: ['QLD', 'NSW', 'VIC'], value: 'VIC', required: true, tooltip: 'Pick one', name: 'region' })
    const f = (await byName(b)).get('region')!
    expect(f).toMatchObject({ options: ['QLD', 'NSW', 'VIC'], value: 'VIC', required: true, tooltip: 'Pick one' })
    b = await addField(b, spec({ name: 'other', rect: { x: 50, y: 90, w: 100, h: 20 } }))
    await expect(updateField(b, 'other', { name: 'region' })).rejects.toThrow(/already a field/)
    await expect(updateField(b, 'missing', {})).rejects.toThrow(/no field called/)
  })

  it('changes a text field and a button', async () => {
    let b = await addField(await blank(), spec({ name: 't' }))
    b = await addField(b, spec({ type: 'button', name: 'btn', caption: 'Go', rect: { x: 50, y: 90, w: 60, h: 20 } }))
    b = await updateField(b, 't', { multiline: true, maxLength: 5, align: 2, value: 'abc', fontSize: 9 })
    b = await updateField(b, 'btn', { caption: 'Send it', action: { kind: 'reset' } })
    const f = await byName(b)
    expect(f.get('t')).toMatchObject({ multiline: true, maxLength: 5, align: 2, value: 'abc', fontSize: 9 })
    expect(f.get('btn')?.widgets[0].caption).toBe('Send it')
    expect(f.get('btn')?.action).toEqual({ kind: 'reset' })
  })
})

describe('placeWidget and deleteField', () => {
  it('moves and resizes a widget (display space) and refuses a box that is too small', async () => {
    let b = await addField(await blank(), spec({ name: 't' }))
    b = await placeWidget(b, 't', 0, { x: 100, y: 200, w: 150, h: 30 })
    expect((await byName(b)).get('t')!.widgets[0].rect).toMatchObject({ x: 100, y: 200, w: 150, h: 30 })
    await expect(placeWidget(b, 't', 0, { x: 0, y: 0, w: 1, h: 1 })).rejects.toThrow(/too small/)
  })

  it('moves a checkbox and keeps it working', async () => {
    let b = await addField(await blank(), spec({ type: 'checkbox', name: 'c', value: true, rect: { x: 50, y: 50, w: 14, h: 14 } }))
    b = await placeWidget(b, 'c', 0, { x: 80, y: 90, w: 20, h: 20 })
    const w = (await byName(b)).get('c')!
    expect(w.value).toBe(true)
    expect(w.widgets[0].rect).toMatchObject({ x: 80, y: 90, w: 20, h: 20 })
  })

  it('deletes a field and leaves no dangling reference on the page', async () => {
    let b = await addField(await blank(), spec({ name: 'a' }))
    b = await addField(b, spec({ name: 'b', rect: { x: 50, y: 90, w: 100, h: 20 } }))
    b = await deleteField(b, 'a')
    expect([...(await byName(b)).keys()]).toEqual(['b'])
    const doc = await PDFDocument.load(b)
    const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)!
    expect(annots.size()).toBe(1)
    await expect(deleteField(b, 'a')).rejects.toThrow(/no field called/)
  })
})

describe('tab order', () => {
  it('sets the page setting and reads it back on every widget', async () => {
    let b = await addField(await blank(), spec({ name: 'a' }))
    b = await setTabOrder(b, 'rows')
    expect((await byName(b)).get('a')!.widgets[0].tabs).toBe('R')
    b = await setTabOrder(b, 'columns')
    expect((await byName(b)).get('a')!.widgets[0].tabs).toBe('C')
  })

  it('moves a field earlier or later in the structure order', async () => {
    let b = await blank()
    for (const [i, n] of ['a', 'b', 'c'].entries()) b = await addField(b, spec({ name: n, rect: { x: 50, y: 50 + i * 30, w: 100, h: 20 } }))
    const order = async (x: Uint8Array) => [...(await byName(x)).values()].sort((p, q) => p.widgets[0].order - q.widgets[0].order).map((f) => f.name)
    expect(await order(b)).toEqual(['a', 'b', 'c'])
    b = await moveInTabOrder(b, 'c', -1)
    expect(await order(b)).toEqual(['a', 'c', 'b'])
    b = await moveInTabOrder(b, 'a', 1)
    expect(await order(b)).toEqual(['c', 'a', 'b'])
    expect((await byName(b)).get('a')!.widgets[0].tabs).toBe('S')
    // At the ends nothing changes.
    expect(await moveInTabOrder(b, 'c', -1)).toBe(b)
  })
})

describe('scripts', () => {
  const sum = 'AFSimple_Calculate("SUM", new Array("a", "b"));'

  it('writes format, keystroke, validate and calculate scripts, and the calculation order', async () => {
    let b = await addField(await blank(), spec({ name: 'a' }))
    b = await addField(b, spec({ name: 'b', rect: { x: 50, y: 90, w: 100, h: 20 } }))
    b = await addField(b, spec({ name: 'total', rect: { x: 50, y: 130, w: 100, h: 20 }, scripts: { calculate: sum, format: 'AFNumber_Format(2, 0, 0, 0, "$", true);', keystroke: 'AFNumber_Keystroke();', validate: 'AFRange_Validate(true, 0, false, 0);' } }))
    let f = await byName(b)
    expect(f.get('total')!.scripts).toEqual({ calculate: sum, format: 'AFNumber_Format(2, 0, 0, 0, "$", true);', keystroke: 'AFNumber_Keystroke();', validate: 'AFRange_Validate(true, 0, false, 0);' })
    expect(f.get('total')!.calcOrder).toBe(0)
    expect(f.get('a')!.scripts).toBeUndefined()
    expect(f.get('a')!.calcOrder).toBeUndefined()

    // A second calculated field comes after the first; removing the first script drops it from the order.
    b = await updateField(b, 'b', { scripts: { calculate: 'event.value = 1;' } })
    f = await byName(b)
    expect(f.get('b')!.calcOrder).toBe(1)
    b = await updateField(b, 'total', { scripts: { format: 'AFNumber_Format(0, 0, 0, 0, "", true);' } })
    f = await byName(b)
    expect(f.get('total')!.scripts).toEqual({ format: 'AFNumber_Format(0, 0, 0, 0, "", true);' })
    expect(f.get('total')!.calcOrder).toBeUndefined()
    expect(f.get('b')!.calcOrder).toBe(0)
    b = await updateField(b, 'b', { scripts: {} })
    expect((await byName(b)).get('b')!.scripts).toBeUndefined()
  })
})
