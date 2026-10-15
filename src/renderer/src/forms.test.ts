import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { applyFormValues, readForm, type FormValue } from './forms'

async function makeForm(rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 500])
  if (rotation) page.setRotation(degrees(rotation))
  const form = doc.getForm()
  const name = form.createTextField('fullname')
  name.setText('Jane Citizen')
  name.addToPage(page, { x: 100, y: 400, width: 200, height: 20, borderWidth: 0 })
  const memo = form.createTextField('memo')
  memo.enableMultiline()
  memo.addToPage(page, { x: 100, y: 440, width: 200, height: 40, borderWidth: 0 })
  const code = form.createTextField('code')
  code.setMaxLength(4)
  code.addToPage(page, { x: 100, y: 360, width: 60, height: 20, borderWidth: 0 })
  const accept = form.createCheckBox('accept')
  accept.addToPage(page, { x: 100, y: 320, width: 14, height: 14, borderWidth: 0 })
  accept.check()
  const trade = form.createRadioGroup('trade')
  for (const [i, o] of ['Civil', 'Landscape', 'Parks'].entries()) trade.addOptionToPage(o, page, { x: 100 + i * 60, y: 280, width: 14, height: 14, borderWidth: 0 })
  trade.select('Parks')
  const state = form.createDropdown('state')
  state.addOptions(['QLD', 'NSW', 'VIC'])
  state.select('QLD')
  state.addToPage(page, { x: 100, y: 240, width: 120, height: 20, borderWidth: 0 })
  const tools = form.createOptionList('tools')
  tools.addOptions(['Excavator', 'Roller', 'Grader'])
  tools.select('Roller')
  tools.addToPage(page, { x: 100, y: 160, width: 120, height: 60, borderWidth: 0 })
  const go = form.createButton('go')
  go.addToPage('Go', page, { x: 100, y: 120, width: 50, height: 20, borderWidth: 0 })
  return doc.save()
}

const byName = async (bytes: Uint8Array) => new Map((await readForm(bytes)).map((f) => [f.name, f]))

describe('readForm', () => {
  it('reads every field with its type, value, options and flags', async () => {
    const f = await byName(await makeForm())
    expect([...f.keys()].sort()).toEqual(['accept', 'code', 'fullname', 'go', 'memo', 'state', 'tools', 'trade'])
    expect(f.get('fullname')).toMatchObject({ type: 'text', value: 'Jane Citizen', readOnly: false })
    expect(f.get('code')?.maxLength).toBe(4)
    expect(f.get('accept')).toMatchObject({ type: 'checkbox', value: true })
    expect(f.get('trade')).toMatchObject({ type: 'radio', value: 'Parks', options: ['Civil', 'Landscape', 'Parks'] })
    expect(f.get('state')).toMatchObject({ type: 'dropdown', value: 'QLD', options: ['QLD', 'NSW', 'VIC'] })
    expect(f.get('tools')).toMatchObject({ type: 'list', value: ['Roller'] })
    expect(f.get('go')?.type).toBe('button')
  })

  it('gives each widget a display-space box (y down from the top) and its on-value', async () => {
    const f = await byName(await makeForm())
    // The page is 500 tall: a field with its bottom at y 400 and height 20 has its top at 500 - 420 = 80.
    expect(f.get('fullname')!.widgets[0]).toMatchObject({ page: 0, rect: { x: 100, y: 80, w: 200, h: 20 } })
    const radios = f.get('trade')!.widgets
    expect(radios).toHaveLength(3)
    expect(radios.map((w) => w.onValue)).toEqual(['Civil', 'Landscape', 'Parks'])
    expect(radios[2].rect.x).toBe(220)
  })

  it('converts boxes on a rotated page to the page as shown', async () => {
    const f = await byName(await makeForm(90))
    const r = f.get('fullname')!.widgets[0].rect
    // Turned a quarter, the 200 x 20 box becomes 20 wide and 200 tall.
    expect(r.w).toBeCloseTo(20)
    expect(r.h).toBeCloseTo(200)
  })
})

describe('applyFormValues', () => {
  const apply = async (values: [string, FormValue][]) => byName(await applyFormValues(await makeForm(), new Map(values)))

  it('sets text, checkbox, radio, dropdown and list values', async () => {
    const f = await apply([
      ['fullname', 'Sam Smith'],
      ['accept', false],
      ['trade', 'Civil'],
      ['state', 'VIC'],
      ['tools', ['Excavator', 'Grader']]
    ])
    expect(f.get('fullname')?.value).toBe('Sam Smith')
    expect(f.get('accept')?.value).toBe(false)
    expect(f.get('trade')?.value).toBe('Civil')
    expect(f.get('state')?.value).toBe('VIC')
    expect(f.get('tools')?.value).toEqual(['Excavator', 'Grader'])
  })

  it('clears fields and respects the maximum length', async () => {
    const f = await apply([
      ['fullname', ''],
      ['trade', ''],
      ['code', 'ABCDEFGH']
    ])
    expect(f.get('fullname')?.value).toBe('')
    expect(f.get('trade')?.value).toBe('')
    expect(f.get('code')?.value).toBe('ABCD')
  })

  it('ignores unknown names and returns the same bytes when there is nothing to write', async () => {
    const bytes = await makeForm()
    expect(await applyFormValues(bytes, new Map())).toBe(bytes)
    const f = await byName(await applyFormValues(bytes, new Map([['nope', 'x']])))
    expect(f.get('fullname')?.value).toBe('Jane Citizen')
  })

  it('keeps the value when the standard font cannot show a character', async () => {
    const f = await apply([['fullname', 'Ben 日本']])
    expect(f.get('fullname')?.value).toBe('Ben 日本')
  })

  it('sizes a multiline field at 12 pt when its size is automatic', async () => {
    // As written by Acrobat: size 0 in the default appearance (saved without pdf-lib sizing it to the box).
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 500])
    const memo = doc.getForm().createTextField('memo')
    memo.enableMultiline()
    memo.addToPage(page, { x: 100, y: 440, width: 200, height: 40, borderWidth: 0 })
    memo.acroField.setDefaultAppearance('/Helv 0 Tf 0 g')
    const auto = await doc.save({ updateFieldAppearances: false })
    expect((await byName(auto)).get('memo')?.fontSize).toBe(0)
    const f = await byName(await applyFormValues(auto, new Map([['memo', 'A note']])))
    expect(f.get('memo')?.fontSize).toBe(12)
  })
})
