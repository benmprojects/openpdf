import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addField, updateFields } from './formDesign'
import { applyFormValues, readForm } from './forms'
import { imageFieldAction } from './formImage'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'))

async function blank() {
  const d = await PDFDocument.create()
  d.addPage([300, 300])
  return d.save()
}

describe('properties of several fields', () => {
  it('changes the same properties on each field and skips what a kind does not have', async () => {
    let b = await blank()
    b = await addField(b, { type: 'text', name: 'a', page: 0, rect: { x: 10, y: 10, w: 100, h: 20 } })
    b = await addField(b, { type: 'checkbox', name: 'b', page: 0, rect: { x: 10, y: 50, w: 14, h: 14 } })
    b = await addField(b, { type: 'dropdown', name: 'c', page: 0, rect: { x: 10, y: 90, w: 100, h: 20 }, options: ['x', 'y'] })
    b = await updateFields(b, ['a', 'b', 'c'], { required: true, fontSize: 11, align: 1, tooltip: 'Fill in' })
    const f = await readForm(b)
    expect(f.map((x) => [x.name, x.required])).toEqual([['a', true], ['b', true], ['c', true]])
    expect(f.find((x) => x.name === 'a')!.fontSize).toBe(11)
    expect(f.find((x) => x.name === 'a')!.align).toBe(1)
    expect(f.find((x) => x.name === 'c')!.fontSize).toBe(11)
    expect(f.every((x) => x.tooltip === 'Fill in')).toBe(true)
  })

  it('leaves the file alone when nothing is to change', async () => {
    const b = await blank()
    expect(await updateFields(b, ['a'], {})).toBe(b)
  })
})

describe('clearing an image field', () => {
  it('removes the picture and brings back the caption', async () => {
    let b = await blank()
    b = await addField(b, { type: 'button', name: 'pic', page: 0, rect: { x: 10, y: 10, w: 80, h: 60 }, caption: 'Add a picture', action: imageFieldAction() })
    const url = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`
    b = await applyFormValues(b, new Map([['pic', url]]))
    expect((await readForm(b))[0].value).toBe(url)
    b = await applyFormValues(b, new Map([['pic', '']]))
    const field = (await readForm(b))[0]
    expect(field.value).toBe('')
    expect(field.widgets[0].caption).toBe('Add a picture')
  })
})
