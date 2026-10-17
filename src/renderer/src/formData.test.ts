import { describe, expect, it } from 'vitest'
import { csvTable, entriesFor, fromCsv, fromFdfData, fromXfdfData, fromXml, populateMatch, populateNames, readDataFile, recordOf, safeFileStem, toCsv, toFdfData, toXfdfData, toXml, valuesFromImport, type DataEntry } from './formData'
import type { FormField, FormValue } from './forms'

const field = (name: string, type: FormField['type'], value: FormValue, extra: Partial<FormField> = {}): FormField => ({
  name,
  type,
  value,
  initial: value,
  readOnly: false,
  required: false,
  align: 0,
  fontSize: 0,
  color: '#000000',
  tooltip: '',
  widgets: [{ page: 0, order: 0, tabs: '', rect: { x: 0, y: 0, w: 10, h: 10 } }],
  ...extra
})

const fields: FormField[] = [
  field('site.name', 'text', 'Eagle Farm <North> & "Yard"'),
  field('site.notes', 'text', 'Line one\nLine two, with a comma'),
  field('accept', 'checkbox', true, { widgets: [{ page: 0, order: 0, tabs: '', rect: { x: 0, y: 0, w: 10, h: 10 }, onValue: 'Yes' }] }),
  field('trade', 'radio', 'Parks', { options: ['Civil', 'Landscape', 'Parks'] }),
  field('state', 'dropdown', 'QLD', { options: ['QLD', 'NSW'] }),
  field('tools', 'list', ['Roller', 'Grader'], { options: ['Excavator', 'Roller', 'Grader'], multiSelect: true }),
  field('go', 'button', ''),
  field('sig', 'signature', '')
]

describe('entriesFor', () => {
  it('lists data fields with current values, using edited values over the file’s', () => {
    const e = entriesFor(fields, new Map<string, FormValue>([['accept', false], ['state', 'NSW']]))
    expect(e.map((x) => x.name)).toEqual(['site.name', 'site.notes', 'accept', 'trade', 'state', 'tools'])
    expect(e.find((x) => x.name === 'accept')?.value).toBe('Off')
    expect(e.find((x) => x.name === 'state')?.value).toBe('NSW')
    expect(entriesFor(fields, new Map()).find((x) => x.name === 'accept')?.value).toBe('Yes')
    expect(e.find((x) => x.name === 'tools')?.value).toEqual(['Roller', 'Grader'])
  })
})

const entries: DataEntry[] = entriesFor(fields, new Map())
const asObject = (m: Map<string, string | string[]>) => Object.fromEntries(m)
const expected = Object.fromEntries(entries.map((e) => [e.name, e.value]))

describe('XFDF', () => {
  it('nests dotted names and round-trips every value, including markup characters and several values', () => {
    const xml = toXfdfData(entries, 'site form.pdf')
    expect(xml).toContain('<f href="site form.pdf"/>')
    expect(xml).toContain('<field name="site"><field name="name"><value>Eagle Farm &lt;North&gt; &amp; &quot;Yard&quot;</value></field>')
    expect(asObject(fromXfdfData(xml))).toEqual(expected)
  })

  it('reads XFDF written elsewhere (namespaces, CDATA, comments, single quotes)', () => {
    const xml = `<?xml version="1.0"?><!-- made by another tool --><x:xfdf xmlns:x="http://ns.adobe.com/xfdf/"><x:fields><x:field name='a'><x:value><![CDATA[1 < 2]]></x:value></x:field><x:field name="b"/></x:fields></x:xfdf>`
    expect(asObject(fromXfdfData(xml))).toEqual({ a: '1 < 2' })
  })

  it('refuses something that is not XFDF', () => {
    expect(() => fromXfdfData('<html></html>')).toThrow(/not an XFDF/)
    expect(() => fromXfdfData('plain text')).toThrow(/not a readable XML/)
  })
})

describe('XML', () => {
  it('round-trips and also accepts XFDF', () => {
    expect(asObject(fromXml(toXml(entries)))).toEqual(expected)
    expect(asObject(fromXml(toXfdfData(entries, 'x.pdf')))).toEqual(expected)
  })
})

describe('CSV', () => {
  it('writes a header row and a value row, quoting where needed, and reads them back', () => {
    const csv = toCsv(entries)
    expect(csv.split('\r\n')[0]).toBe('site.name,site.notes,accept,trade,state,tools')
    const back = fromCsv(csv)
    expect(back.get('site.name')).toBe('Eagle Farm <North> & "Yard"')
    expect(back.get('site.notes')).toBe('Line one\nLine two, with a comma')
    // A list box's choices share one cell, joined with "; ".
    expect(back.get('tools')).toBe('Roller; Grader')
  })

  it('reads a file with a byte order mark and the first data row only', () => {
    const m = fromCsv('﻿a,b\r\n1,"x,y"\r\n2,3\r\n')
    expect([...m]).toEqual([['a', '1'], ['b', 'x,y']])
    expect(() => fromCsv('only,a,header')).toThrow(/needs a row/)
  })
})

describe('FDF', () => {
  it('round-trips through the binary file, nested names and non-Latin text included', async () => {
    const more: DataEntry[] = [...entries, { name: 'greeting', value: 'こんにちは 😀' }]
    const bytes = toFdfData(more, 'form.pdf')
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%FDF-1.2')
    const back = await fromFdfData(bytes)
    expect(asObject(back)).toEqual({ ...expected, greeting: 'こんにちは 😀' })
  })

  it('refuses something that is not FDF', async () => {
    await expect(fromFdfData(new TextEncoder().encode('%PDF-1.7 nope'))).rejects.toThrow(/not an FDF/)
  })
})

describe('readDataFile', () => {
  it('picks the reader by extension', async () => {
    expect(asObject(await readDataFile('x.XFDF', new TextEncoder().encode(toXfdfData(entries, 'a.pdf'))))).toEqual(expected)
    expect(asObject(await readDataFile('x.fdf', toFdfData(entries, 'a.pdf')))).toEqual(expected)
    expect((await readDataFile('x.csv', new TextEncoder().encode(toCsv(entries)))).get('accept')).toBe('Yes')
    await expect(readDataFile('x.json', new Uint8Array())).rejects.toThrow(/Choose an FDF/)
  })
})

describe('valuesFromImport', () => {
  const raw = (o: Record<string, string | string[]>) => new Map(Object.entries(o))

  it('turns imported text into the right kind of value for each field', () => {
    const v = valuesFromImport(fields, raw({ 'site.name': 'New', accept: 'Off', trade: '1', state: 'NSW', tools: ['Excavator', 'Nope'] }))
    expect(v.get('site.name')).toBe('New')
    expect(v.get('accept')).toBe(false)
    expect(v.get('trade')).toBe('Landscape')
    expect(v.get('state')).toBe('NSW')
    expect(v.get('tools')).toEqual(['Excavator'])
  })

  it('splits a CSV list cell on semicolons', () => {
    expect(valuesFromImport(fields, raw({ tools: 'Roller; Grader' })).get('tools')).toEqual(['Roller', 'Grader'])
  })

  it('accepts several spellings of on', () => {
    expect(valuesFromImport(fields, raw({ accept: 'true' })).get('accept')).toBe(true)
    expect(valuesFromImport(fields, raw({ accept: 'Yes' })).get('accept')).toBe(true)
    expect(valuesFromImport(fields, raw({ accept: '' })).get('accept')).toBe(false)
  })

  it('skips unknown, read-only, button and signature fields, and respects a maximum length', () => {
    const f = [field('locked', 'text', 'a', { readOnly: true }), field('short', 'text', '', { maxLength: 3 }), field('go', 'button', '')]
    const v = valuesFromImport(f, raw({ locked: 'x', short: 'abcdef', go: 'x', ghost: 'y' }))
    expect([...v]).toEqual([['short', 'abc']])
  })
})

describe('populate from a CSV', () => {
  const field = (name: string, extra: Partial<FormField> = {}): FormField => ({ name, type: 'text', value: '', initial: '', readOnly: false, required: false, align: 0, fontSize: 0, color: '#000', tooltip: '', widgets: [], ...extra })

  it('reads a header and every record, with quotes and line breaks', () => {
    const t = csvTable('﻿name,site,note\r\nAda,"North, Depot","line1\nline2"\r\n\r\nBen,South,\r\n')
    expect(t.header).toEqual(['name', 'site', 'note'])
    expect(t.rows).toEqual([['Ada', 'North, Depot', 'line1\nline2'], ['Ben', 'South', '']])
    expect(recordOf(t, t.rows[0]).get('site')).toBe('North, Depot')
    expect(() => csvTable('only,a,header')).toThrow(/at least one row/)
  })

  it('reports columns without a field and fields without a column', () => {
    const fields = [field('name'), field('site'), field('locked', { readOnly: true }), field('go', { type: 'button' })]
    expect(populateMatch(fields, ['name', 'extra', ''])).toEqual({ unknownColumns: ['extra'], unfilledFields: ['site'] })
  })

  it('names the output files from a column, safely and without clashes', () => {
    const t = csvTable('id,client\n1,Smith/Jones\n2,Smith/Jones\n3,\n4,CON\n5,"  A: B?  "')
    expect(populateNames(t, 'client', 'Form')).toEqual(['Smith-Jones', 'Smith-Jones (2)', 'Form 3', 'Form 4', 'A- B-'])
    expect(populateNames(t, null, 'Form')).toEqual(['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5'])
    expect(populateNames(t, 'missing', 'Form')[0]).toBe('Form 1')
  })

  it('replaces every character Windows refuses in a file name', () => {
    expect(safeFileStem('a\\b/c:d*e?f"g<h>i|j\tk', 'x')).toBe('a-b-c-d-e-f-g-h-i-j-k')
    expect(safeFileStem('...', 'x')).toBe('x')
  })

  it('does not let a name clash by case', () => {
    const t = csvTable('n\nabc\nABC')
    expect(populateNames(t, 'n', 'F')).toEqual(['abc', 'ABC (2)'])
  })

  it('turns a record into field values', () => {
    const fields = [field('name'), field('agree', { type: 'checkbox', value: false, initial: false, widgets: [{ page: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, order: 0, tabs: '', onValue: 'Yes' }] })]
    const t = csvTable('name,agree\nAda,Yes\nBen,No')
    const a = valuesFromImport(fields, recordOf(t, t.rows[0]))
    const b = valuesFromImport(fields, recordOf(t, t.rows[1]))
    expect([a.get('name'), a.get('agree')]).toEqual(['Ada', true])
    expect([b.get('name'), b.get('agree')]).toEqual(['Ben', false])
  })
})
