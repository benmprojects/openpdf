import { describe, expect, it } from 'vitest'
import { buildScripts, DEFAULT_UI, describeScripts, parseScripts, type ScriptUi } from './scriptPresets'

const ui = (over: Partial<ScriptUi>): ScriptUi => ({ ...DEFAULT_UI, ...over })

describe('buildScripts', () => {
  it('makes the standard calls for each format', () => {
    expect(buildScripts(ui({ format: 'number', decimals: 2, separators: 0, currency: '$', currencyFirst: true }))).toEqual({
      format: 'AFNumber_Format(2, 0, 0, 0, "$", true);',
      keystroke: 'AFNumber_Keystroke(2, 0, 0, 0, "$", true);'
    })
    expect(buildScripts(ui({ format: 'percent', decimals: 1 })).format).toBe('AFPercent_Format(1, 0);')
    expect(buildScripts(ui({ format: 'date', dateFormat: 'd mmm yyyy' }))).toEqual({ format: 'AFDate_FormatEx("d mmm yyyy");', keystroke: 'AFDate_KeystrokeEx("d mmm yyyy");' })
    expect(buildScripts(ui({ format: 'time', timeFormat: 'h:MM tt' })).format).toBe('AFTime_FormatEx("h:MM tt");')
    expect(buildScripts(ui({ format: 'special', special: 2 })).keystroke).toBe('AFSpecial_Keystroke(2);')
    expect(buildScripts(ui({ negativeBrackets: true, format: 'number' })).format).toContain(', 2, 0,')
  })

  it('makes range and calculation scripts', () => {
    expect(buildScripts(ui({ validate: 'range', min: '0', max: '100' })).validate).toBe('AFRange_Validate(true, 0, true, 100);')
    expect(buildScripts(ui({ validate: 'range', min: '5', max: '' })).validate).toBe('AFRange_Validate(true, 5, false, 0);')
    expect(buildScripts(ui({ validate: 'range', min: '', max: '' })).validate).toBeUndefined()
    expect(buildScripts(ui({ calculate: 'SUM', sources: ['a', 'b "x"'] })).calculate).toBe('AFSimple_Calculate("SUM", new Array("a", "b \\"x\\""));')
    expect(buildScripts(ui({ calculate: 'SUM', sources: [] })).calculate).toBeUndefined()
  })

  it('keeps custom scripts as written', () => {
    const custom = { format: 'event.value = event.value.toUpperCase();', validate: 'event.rc = event.value.length < 5;', calculate: 'event.value = 1;' }
    expect(buildScripts(ui({ format: 'custom', validate: 'custom', calculate: 'custom', custom }))).toEqual(custom)
  })
})

describe('parseScripts', () => {
  it('reads generated scripts back into the same choices', () => {
    const cases: Partial<ScriptUi>[] = [
      { format: 'number', decimals: 3, separators: 2, currency: 'AUD', currencyFirst: false, negativeBrackets: true },
      { format: 'percent', decimals: 0, separators: 1 },
      { format: 'date', dateFormat: 'dd/mm/yyyy' },
      { format: 'time', timeFormat: 'HH:MM:ss' },
      { format: 'special', special: 1 },
      { validate: 'range', min: '-5', max: '10.5' },
      { calculate: 'AVG', sources: ['x', 'y', 'z'] }
    ]
    for (const c of cases) {
      const built = buildScripts(ui(c))
      const back = parseScripts(built)
      expect(back, JSON.stringify(c)).toMatchObject(c)
      expect(buildScripts(back)).toEqual(built)
    }
  })

  it('treats anything else as custom', () => {
    expect(parseScripts({ format: 'event.value = "x";' }).format).toBe('custom')
    expect(parseScripts({ validate: 'if (event.value) event.rc = false;' }).validate).toBe('custom')
    expect(parseScripts({ calculate: 'event.value = 3;' }).calculate).toBe('custom')
    // A recognised format with a hand-written keystroke is custom, so the keystroke is not lost.
    expect(parseScripts({ format: 'AFNumber_Format(2, 0, 0, 0, "", true);', keystroke: 'event.rc = true;' }).format).toBe('custom')
    expect(parseScripts(undefined)).toMatchObject({ format: 'none', validate: 'none', calculate: 'none' })
  })

  it('describes scripts briefly', () => {
    expect(describeScripts(buildScripts(ui({ format: 'number', validate: 'range', min: '0', max: '9', calculate: 'SUM', sources: ['a'] })))).toBe('number format, range check, sum calculation')
    expect(describeScripts(undefined)).toBe('')
  })
})
