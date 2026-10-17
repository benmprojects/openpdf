import { describe, expect, it } from 'vitest'
import { dateFormatOf, formatDate, fromInputValue, parseDate, toInputValue } from './dateField'
import { buildScripts, DEFAULT_UI } from './scriptPresets'
import { displayValue, fieldStates } from './formScripts'
import type { FormField } from './forms'

const d = new Date(2026, 9, 5, 12)

describe('date forms', () => {
  it('formats a date in several forms', () => {
    expect(formatDate(d, 'dd/mm/yyyy')).toBe('05/10/2026')
    expect(formatDate(d, 'd/m/yy')).toBe('5/10/26')
    expect(formatDate(d, 'd mmm yyyy')).toBe('5 Oct 2026')
    expect(formatDate(d, 'dddd d mmmm yyyy')).toBe('Monday 5 October 2026')
    expect(formatDate(d, 'yyyy-mm-dd')).toBe('2026-10-05')
  })

  it('reads a date back from its own form', () => {
    for (const form of ['dd/mm/yyyy', 'd/m/yy', 'd mmm yyyy', 'dddd d mmmm yyyy', 'yyyy-mm-dd']) {
      const back = parseDate(formatDate(d, form), form)
      expect(back && toInputValue(back), form).toBe('2026-10-05')
    }
  })

  it('refuses text that is not a date in that form', () => {
    expect(parseDate('31/02/2026', 'dd/mm/yyyy')).toBeNull()
    expect(parseDate('hello', 'dd/mm/yyyy')).toBeNull()
    expect(parseDate('5 Foo 2026', 'd mmm yyyy')).toBeNull()
  })

  it('converts to and from the value of a date input', () => {
    expect(toInputValue(new Date(2027, 0, 9))).toBe('2027-01-09')
    expect(fromInputValue('2027-01-09')?.getDate()).toBe(9)
    expect(fromInputValue('')).toBeNull()
  })

  it('finds the date form of a date field, and only of a date field', () => {
    const scripts = buildScripts({ ...DEFAULT_UI, format: 'date', dateFormat: 'd mmm yyyy' })
    expect(dateFormatOf({ type: 'text', scripts })).toBe('d mmm yyyy')
    expect(dateFormatOf({ type: 'checkbox', scripts })).toBeNull()
    expect(dateFormatOf({ type: 'text', scripts: { format: 'AFNumber_Format(2, 0, 0, 0, "", true);' } })).toBeNull()
    expect(dateFormatOf({ type: 'text' })).toBeNull()
  })

  it("is read by the field's own format script (the picker's text survives formatting)", async () => {
    for (const form of ['dd/mm/yyyy', 'd mmm yyyy', 'dddd d mmmm yyyy']) {
      const scripts = buildScripts({ ...DEFAULT_UI, format: 'date', dateFormat: form })
      const f = { name: 'when', type: 'text', value: '', initial: '', readOnly: false, required: false, align: 0, fontSize: 0, color: '#000', tooltip: '', scripts, widgets: [] } as FormField
      const text = formatDate(d, form)
      expect(await displayValue(f, text, fieldStates([f], new Map())), form).toBe(text)
    }
  })
})
