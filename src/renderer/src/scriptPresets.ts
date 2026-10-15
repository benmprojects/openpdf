/**
 * Standard form scripts for the field dialog: choices such as "Number with 2 decimals" or "Sum of these fields" become
 * the usual Acrobat script calls, and scripts of that shape are read back into the same choices (anything else is a
 * custom script and is kept as written).
 */
import type { FieldScripts } from './forms'

export type FormatChoice = 'none' | 'number' | 'percent' | 'date' | 'time' | 'special' | 'custom'
export type ValidateChoice = 'none' | 'range' | 'custom'
export type CalcChoice = 'none' | 'SUM' | 'PRD' | 'AVG' | 'MIN' | 'MAX' | 'custom'

export interface ScriptUi {
  format: FormatChoice
  decimals: number
  /** 0 1,234.56  1 1234.56  2 1.234,56  3 1234,56  4 1'234.56 */
  separators: 0 | 1 | 2 | 3 | 4
  currency: string
  currencyFirst: boolean
  negativeBrackets: boolean
  dateFormat: string
  timeFormat: string
  /** 0 post code, 1 post code and 4 digits, 2 phone, 3 social security number */
  special: 0 | 1 | 2 | 3
  validate: ValidateChoice
  min: string
  max: string
  calculate: CalcChoice
  sources: string[]
  /** Scripts as written, for the "custom" choices. */
  custom: FieldScripts
}

export const DEFAULT_UI: ScriptUi = {
  format: 'none',
  decimals: 2,
  separators: 0,
  currency: '',
  currencyFirst: true,
  negativeBrackets: false,
  dateFormat: 'dd/mm/yyyy',
  timeFormat: 'HH:MM',
  special: 2,
  validate: 'none',
  min: '',
  max: '',
  calculate: 'none',
  sources: [],
  custom: {}
}

const q = (s: string) => JSON.stringify(s)

export function buildScripts(u: ScriptUi): FieldScripts {
  const out: FieldScripts = {}
  const neg = u.negativeBrackets ? 2 : 0
  if (u.format === 'number') {
    const args = `${u.decimals}, ${u.separators}, ${neg}, 0, ${q(u.currency)}, ${u.currencyFirst}`
    out.format = `AFNumber_Format(${args});`
    out.keystroke = `AFNumber_Keystroke(${args});`
  } else if (u.format === 'percent') {
    out.format = `AFPercent_Format(${u.decimals}, ${u.separators});`
    out.keystroke = `AFPercent_Keystroke(${u.decimals}, ${u.separators});`
  } else if (u.format === 'date') {
    out.format = `AFDate_FormatEx(${q(u.dateFormat)});`
    out.keystroke = `AFDate_KeystrokeEx(${q(u.dateFormat)});`
  } else if (u.format === 'time') {
    out.format = `AFTime_FormatEx(${q(u.timeFormat)});`
    out.keystroke = `AFTime_KeystrokeEx(${q(u.timeFormat)});`
  } else if (u.format === 'special') {
    out.format = `AFSpecial_Format(${u.special});`
    out.keystroke = `AFSpecial_Keystroke(${u.special});`
  } else if (u.format === 'custom') {
    if (u.custom.format) out.format = u.custom.format
    if (u.custom.keystroke) out.keystroke = u.custom.keystroke
  }
  if (u.validate === 'range') {
    const lo = u.min.trim() !== '' && Number.isFinite(Number(u.min))
    const hi = u.max.trim() !== '' && Number.isFinite(Number(u.max))
    if (lo || hi) out.validate = `AFRange_Validate(${lo}, ${lo ? Number(u.min) : 0}, ${hi}, ${hi ? Number(u.max) : 0});`
  } else if (u.validate === 'custom' && u.custom.validate) out.validate = u.custom.validate
  if (u.calculate !== 'none' && u.calculate !== 'custom') {
    if (u.sources.length) out.calculate = `AFSimple_Calculate(${q(u.calculate)}, new Array(${u.sources.map(q).join(', ')}));`
  } else if (u.calculate === 'custom' && u.custom.calculate) out.calculate = u.custom.calculate
  return out
}

/** The choices that produce these scripts, or "custom" with the scripts kept as written. */
export function parseScripts(s: FieldScripts | undefined): ScriptUi {
  const u: ScriptUi = { ...DEFAULT_UI, sources: [], custom: { ...(s ?? {}) } }
  if (!s) return u
  const num = /^AFNumber_Format\((\d+), (\d), (\d), 0, ("(?:[^"\\]|\\.)*"), (true|false)\);$/.exec(s.format ?? '')
  const pct = /^AFPercent_Format\((\d+), (\d)\);$/.exec(s.format ?? '')
  const date = /^AFDate_FormatEx\(("(?:[^"\\]|\\.)*")\);$/.exec(s.format ?? '')
  const time = /^AFTime_FormatEx\(("(?:[^"\\]|\\.)*")\);$/.exec(s.format ?? '')
  const special = /^AFSpecial_Format\((\d)\);$/.exec(s.format ?? '')
  if (num) Object.assign(u, { format: 'number', decimals: Number(num[1]), separators: Number(num[2]) as ScriptUi['separators'], negativeBrackets: Number(num[3]) >= 2, currency: JSON.parse(num[4]), currencyFirst: num[5] === 'true' })
  else if (pct) Object.assign(u, { format: 'percent', decimals: Number(pct[1]), separators: Number(pct[2]) as ScriptUi['separators'] })
  else if (date) Object.assign(u, { format: 'date', dateFormat: JSON.parse(date[1]) })
  else if (time) Object.assign(u, { format: 'time', timeFormat: JSON.parse(time[1]) })
  else if (special) Object.assign(u, { format: 'special', special: Number(special[1]) as ScriptUi['special'] })
  else if (s.format) u.format = 'custom'
  // A custom keystroke script alongside a recognised format is kept only if it is not the one the format generates.
  if (u.format !== 'custom' && u.format !== 'none') {
    const generated = buildScripts({ ...u, validate: 'none', calculate: 'none' })
    if (s.keystroke && s.keystroke !== generated.keystroke) {
      u.format = 'custom'
    }
  } else if (u.format === 'none' && s.keystroke) u.format = 'custom'

  const range = /^AFRange_Validate\((true|false), (-?[\d.]+), (true|false), (-?[\d.]+)\);$/.exec(s.validate ?? '')
  if (range) Object.assign(u, { validate: 'range', min: range[1] === 'true' ? range[2] : '', max: range[3] === 'true' ? range[4] : '' })
  else if (s.validate) u.validate = 'custom'

  const calc = /^AFSimple_Calculate\("(SUM|PRD|AVG|MIN|MAX)", new Array\(((?:"(?:[^"\\]|\\.)*"(?:, )?)*)\)\);$/.exec(s.calculate ?? '')
  if (calc) Object.assign(u, { calculate: calc[1] as CalcChoice, sources: (calc[2].match(/"(?:[^"\\]|\\.)*"/g) ?? []).map((x) => JSON.parse(x) as string) })
  else if (s.calculate) u.calculate = 'custom'
  return u
}

/** Short description of a field's scripts, for lists. */
export function describeScripts(s: FieldScripts | undefined): string {
  if (!s) return ''
  const u = parseScripts(s)
  const parts: string[] = []
  if (u.format !== 'none') parts.push(u.format === 'custom' ? 'custom format' : `${u.format} format`)
  if (u.validate !== 'none') parts.push(u.validate === 'range' ? 'range check' : 'custom check')
  if (u.calculate !== 'none') parts.push(u.calculate === 'custom' ? 'custom calculation' : `${u.calculate.toLowerCase()} calculation`)
  return parts.join(', ')
}
