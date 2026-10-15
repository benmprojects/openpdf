import { describe, expect, it } from 'vitest'
import type { FormField, FormValue } from './forms'
import { commitValue, displayValue, fieldStates, recalculate, runScript, type FieldState } from './formScripts'

const st = (name: string, value: FormValue, extra: Partial<FieldState> = {}): FieldState => ({ name, type: 'text', value, readOnly: false, numeric: false, ...extra })
const run = (code: string, value = '', fields: FieldState[] = [], kind: 'Format' | 'Keystroke' | 'Validate' | 'Calculate' = 'Format') => runScript(kind, code, 'target', [st('target', value), ...fields], { value })

const field = (name: string, scripts: FormField['scripts'], value: FormValue = '', extra: Partial<FormField> = {}): FormField => ({
  name,
  type: 'text',
  value,
  initial: value,
  readOnly: false,
  required: false,
  align: 0,
  fontSize: 0,
  color: '#000000',
  tooltip: '',
  scripts,
  widgets: [],
  ...extra
})

describe('number formats', () => {
  it('formats with decimals, separators, currency and negatives', async () => {
    expect((await run('AFNumber_Format(2, 0, 0, 0, "$", true);', '1234.5')).value).toBe('$1,234.50')
    expect((await run('AFNumber_Format(0, 1, 0, 0, "", true);', '1234567.4')).value).toBe('1234567')
    expect((await run('AFNumber_Format(2, 2, 0, 0, "", true);', '1234.5')).value).toBe('1.234,50')
    expect((await run('AFNumber_Format(2, 4, 0, 0, "", true);', '1234567.891')).value).toBe("1'234'567.89")
    expect((await run('AFNumber_Format(1, 0, 2, 0, "$", true);', '-45.25')).value).toBe('($45.3)')
    expect((await run('AFNumber_Format(2, 0, 0, 0, "AUD", false);', '10')).value).toBe('10.00 AUD')
    expect((await run('AFNumber_Format(2, 0, 0, 0, "", true);', '')).value).toBe('')
    expect((await run('AFNumber_Format(2, 0, 0, 0, "", true);', 'abc')).value).toBe('')
  })

  it('reads numbers written with separators and currency', async () => {
    const n = async (s: string) => (await run('event.value = String(AFMakeNumber(event.value));', s)).value
    expect(await n('$1,234.50')).toBe('1234.5')
    expect(await n('1.234,50')).toBe('1234.5')
    expect(await n('1,5')).toBe('1.5')
    expect(await n('(12)')).toBe('-12')
    expect(await n('x')).toBe('null')
  })

  it('percentages and the number keystroke', async () => {
    expect((await run('AFPercent_Format(1, 0);', '0.255')).value).toBe('25.5%')
    const bad = await run('AFNumber_Keystroke();', 'twelve', [], 'Keystroke')
    expect(bad.rc).toBe(false)
    expect(bad.alerts).toEqual(['The value must be a number.'])
    expect((await run('AFNumber_Keystroke();', '12.5', [], 'Keystroke')).rc).toBe(true)
  })
})

describe('dates, times and special formats', () => {
  it('formats a date in the field format, reading day first', async () => {
    expect((await run('AFDate_FormatEx("dd/mm/yyyy");', '5/3/2026')).value).toBe('05/03/2026')
    expect((await run('AFDate_FormatEx("d mmmm yyyy");', '2026-03-05')).value).toBe('5 March 2026')
    expect((await run('AFDate_FormatEx("dddd d mmm yy");', '15/10/26')).value).toBe('Thursday 15 Oct 26')
    expect((await run('AFDate_FormatEx("dd/mm/yyyy");', '31/02/2026')).value).toBe('')
  })

  it('validates a date on commit', async () => {
    expect((await run('AFDate_KeystrokeEx("dd/mm/yyyy");', '15/10/2026', [], 'Keystroke')).rc).toBe(true)
    const bad = await run('AFDate_KeystrokeEx("dd/mm/yyyy");', 'next week', [], 'Keystroke')
    expect(bad.rc).toBe(false)
    expect(bad.alerts[0]).toContain('dd/mm/yyyy')
  })

  it('formats times, and special numbers', async () => {
    expect((await run('AFTime_FormatEx("h:MM tt");', '13:05')).value).toBe('1:05 pm')
    expect((await run('AFTime_Format(0);', '9:30 pm')).value).toBe('21:30')
    expect((await run('AFSpecial_Format(2);', '0732123456')).value).toBe('(073) 212-3456')
    expect((await run('AFSpecial_Format(0);', '4000')).value).toBe('4000')
    expect((await run('AFSpecial_Keystroke(0);', '123', [], 'Keystroke')).rc).toBe(false)
  })
})

describe('calculation and validation', () => {
  const fields = [st('a', '10', { numeric: true }), st('b', '2.5', { numeric: true }), st('c', 'x')]
  it('AFSimple_Calculate over fields', async () => {
    const calc = async (fn: string) => (await run(`AFSimple_Calculate("${fn}", new Array("a", "b", "c"));`, '', fields, 'Calculate')).value
    expect(await calc('SUM')).toBe('12.5')
    expect(await calc('PRD')).toBe('0')
    expect(await calc('AVG')).toBe('4.166666666666667')
    expect(await calc('MIN')).toBe('0')
    expect(await calc('MAX')).toBe('10')
    expect((await run('AFSimple_Calculate("SUM", "a, b");', '', fields, 'Calculate')).value).toBe('12.5')
  })

  it('range validation rejects with a message', async () => {
    const r = await run('AFRange_Validate(true, 0, true, 100);', '150', [], 'Validate')
    expect(r.rc).toBe(false)
    expect(r.alerts).toEqual(['The value must be between 0 and 100.'])
    expect((await run('AFRange_Validate(true, 0, true, 100);', '50', [], 'Validate')).rc).toBe(true)
    expect((await run('AFRange_Validate(true, 1, false, 0);', '0', [], 'Validate')).alerts).toEqual(['The value must be at least 1.'])
  })

  it('scripts can read and set other fields, and report what changed', async () => {
    const r = await run('var f = this.getField("a"); this.getField("b").value = f.value * 2; event.value = f.name + "/" + (f.value + 1);', '', fields, 'Calculate')
    expect(r.value).toBe('a/11')
    // Numbers a script sets come back as text, like every other field value.
    expect(Object.fromEntries(r.changed)).toEqual({ b: '20' })
    expect((await run('event.value = String(this.getField("nope"));', '', fields)).value).toBe('null')
    // A read-only field cannot be written.
    const ro = await runScript('Calculate', 'this.getField("r").value = "x";', 'target', [st('target', ''), st('r', 'keep', { readOnly: true })], {})
    expect(ro.changed.size).toBe(0)
  })

  it('resetForm clears fields, event.rc can be set, console and util work', async () => {
    const r = await run('this.resetForm(["a"]); console.println("hi"); event.value = util.printd("yyyy-mm-dd", new Date(2026, 9, 15));', '', fields, 'MouseUp' as never)
    expect(r.value).toBe('2026-10-15')
    expect(r.log).toEqual(['hi'])
    expect(r.changed.get('a')).toBe('')
  })
})

describe('the sandbox', () => {
  it('stops a script that never ends', async () => {
    const t = Date.now()
    const r = await run('while (true) {}')
    expect(r.error).toMatch(/took too long/)
    expect(Date.now() - t).toBeLessThan(3000)
  })

  it('has no access to the host: no process, require, fetch, window, files or timers', async () => {
    for (const probe of ['typeof process', 'typeof require', 'typeof fetch', 'typeof window', 'typeof document', 'typeof XMLHttpRequest', 'typeof setTimeout', 'typeof WebAssembly', 'typeof globalThis.openpdf']) {
      expect((await run(`event.value = ${probe};`)).value, probe).toBe('undefined')
    }
  })

  it('reports syntax errors and thrown errors without crashing', async () => {
    expect((await run('this is not javascript')).error).toBeTruthy()
    expect((await run('throw new Error("boom")')).error).toBe('boom')
    expect((await run('undefinedFunction()')).error).toMatch(/not defined/)
  })

  it('caps memory', async () => {
    const r = await run('var a = []; while (true) { a.push(new Array(100000).fill("xxxxxxxx")); }')
    expect(r.error).toBeTruthy()
  }, 30000)

  it('cannot reach into the host through the input: a hostile field name is just data', async () => {
    const r = await runScript('Format', 'event.value = this.getField("x\\"; process.exit(1); \\"").value;', 'target', [st('target', ''), st('x"; process.exit(1); "', 'safe')], { value: '' })
    expect(r.value).toBe('safe')
  })
})

describe('field helpers', () => {
  const total = field('total', { calculate: 'AFSimple_Calculate("SUM", new Array("a", "b"));', format: 'AFNumber_Format(2, 0, 0, 0, "$", true);' })
  const a = field('a', undefined, '10')
  const b = field('b', undefined, '5.5')
  const fields = [a, b, total]

  it('shows a value through its format script', async () => {
    expect(await displayValue(total, '1234.5', fieldStates(fields, new Map()))).toBe('$1,234.50')
    expect(await displayValue(a, '1234.5', fieldStates(fields, new Map()))).toBe('1234.5')
    expect(await displayValue(total, '', [])).toBe('')
  })

  it('checks a value on commit: keystroke, then validate', async () => {
    const age = field('age', { keystroke: 'AFNumber_Keystroke();', validate: 'AFRange_Validate(true, 0, true, 120);' })
    const s = fieldStates([age], new Map())
    expect(await commitValue(age, '42', s)).toMatchObject({ ok: true, value: '42' })
    expect(await commitValue(age, 'abc', s)).toMatchObject({ ok: false, alerts: ['The value must be a number.'] })
    expect(await commitValue(age, '200', s)).toMatchObject({ ok: false, alerts: ['The value must be between 0 and 120.'] })
    // A script error does not block the value.
    const odd = field('odd', { validate: 'oops(' })
    expect((await commitValue(odd, 'x', [])).ok).toBe(true)
  })

  it('a keystroke script may change the value', async () => {
    const upper = field('code', { keystroke: 'event.value = event.value.toUpperCase();' })
    expect((await commitValue(upper, 'abc', [])).value).toBe('ABC')
  })

  it('recalculates in order until nothing changes, and follows chains', async () => {
    const withValues = new Map<string, FormValue>([['a', '10'], ['b', '20']])
    const r = await recalculate(fields, withValues)
    expect(Object.fromEntries(r.changed)).toEqual({ total: '30' })
    // A calculation that feeds another: tax is 10 % of total, grand is total + tax.
    const tax = field('tax', { calculate: 'event.value = AFMakeNumber(this.getField("total").value) * 0.1;' }, '', { calcOrder: 1 })
    const grand = field('grand', { calculate: 'event.value = AFMakeNumber(this.getField("total").value) + AFMakeNumber(this.getField("tax").value);' }, '', { calcOrder: 2 })
    const chain = await recalculate([a, b, { ...total, calcOrder: 0 }, tax, grand], withValues)
    expect(Object.fromEntries(chain.changed)).toEqual({ total: '30', tax: '3', grand: '33' })
    // Nothing to do when the values are already right.
    expect((await recalculate(fields, new Map([['a', '10'], ['b', '20'], ['total', '30']]))).changed.size).toBe(0)
  })

  it('a runaway calculation does not hang and is reported', async () => {
    const bad = field('bad', { calculate: 'while (true) {}' })
    const r = await recalculate([bad], new Map())
    expect(r.error).toMatch(/too long/)
  })
})
