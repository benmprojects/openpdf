/**
 * Named scales, units and number formatting for measurements (pure, no DOM).
 *
 * A drawing scale such as 1:100 means 1 unit on paper is 100 of the same unit on the ground. Page space is in
 * points (1/72 inch), so a scale becomes "real units per point".
 */

export const MM_PER_PT = 25.4 / 72

/** Units a scale can report in. `ft-in` shows feet and inches (12' 3 1/2"). */
export const UNITS = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'ft-in', 'yd'] as const
export type LengthUnit = (typeof UNITS)[number]

/** Millimetres in one unit. `ft-in` counts in feet. */
const MM_PER_UNIT: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, km: 1_000_000, in: 25.4, ft: 304.8, 'ft-in': 304.8, yd: 914.4 }

export const isUnit = (u: string): u is LengthUnit => (UNITS as readonly string[]).includes(u)
export const isImperial = (u: string) => u === 'in' || u === 'ft' || u === 'ft-in' || u === 'yd'

/** Ratios offered in the Scale dialog (paper : real, so 100 means 1:100). */
export const PRESET_RATIOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000] as const

/** How results are rounded: a number of decimal places, or the nearest 1/n (imperial only). */
export type Precision = { decimals: number } | { fraction: number }

export const FRACTIONS = [2, 4, 8, 16, 32, 64] as const

/** A scale as saved in settings and offered again in the dialog. */
export interface ScalePreset {
  id: string
  name: string
  /** 1:`ratio`. */
  ratio: number
  unit: string
  /** Decimal places; ignored when `fraction` is set. */
  decimals?: number
  /** Round to the nearest 1/fraction of the unit (inches and feet-inches). */
  fraction?: number
}

export function precisionOf(p: { decimals?: number; fraction?: number }): Precision | undefined {
  if (p.fraction && p.fraction >= 2) return { fraction: Math.round(p.fraction) }
  if (typeof p.decimals === 'number' && p.decimals >= 0) return { decimals: Math.min(6, Math.floor(p.decimals)) }
  return undefined
}

/** Real units per page point for a 1:`ratio` drawing reported in `unit`. */
export function factorForRatio(ratio: number, unit: string): number {
  if (!(ratio > 0)) throw new Error('The scale ratio must be above zero.')
  if (!isUnit(unit)) throw new Error(`Unknown unit ${unit}.`)
  return (ratio * MM_PER_PT) / MM_PER_UNIT[unit]
}

/** The ratio for "`paperMm` mm on paper = `real` `unit` in real life". */
export function ratioFromCustom(paperMm: number, real: number, unit: string): number {
  if (!(paperMm > 0) || !(real > 0)) throw new Error('Enter the paper length and the real length, both above zero.')
  if (!isUnit(unit)) throw new Error(`Unknown unit ${unit}.`)
  return (real * MM_PER_UNIT[unit]) / paperMm
}

/** Text for a ratio: 100 is "1:100"; 0.5 (an enlargement) is "2:1". */
export function ratioText(ratio: number): string {
  const r = (n: number) => Number(n.toFixed(4)).toString()
  return ratio >= 1 ? `1:${r(ratio)}` : `${r(1 / ratio)}:1`
}

/** Parses "1:50", "1 : 50", "50" or "2:1" into a ratio; null when it is not one. */
export function parseRatio(text: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?::|\/)\s*(\d+(?:[.,]\d+)?)\s*$/.exec(text)
  const num = (s: string) => Number(s.replace(',', '.'))
  if (m) {
    const a = num(m[1])
    const b = num(m[2])
    return a > 0 && b > 0 ? b / a : null
  }
  const n = /^\s*\d+(?:[.,]\d+)?\s*$/.exec(text)
  return n && num(n[0]) > 0 ? num(n[0]) : null
}

/** Converts a value between units. */
export function convert(value: number, from: string, to: string): number {
  if (!isUnit(from) || !isUnit(to)) return value
  return (value * MM_PER_UNIT[from]) / MM_PER_UNIT[to]
}

const AUTO_DIGITS = (abs: number) => (abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3)

function decimal(n: number, decimals: number | undefined): string {
  const d = decimals ?? AUTO_DIGITS(Math.abs(n))
  const fixed = n.toLocaleString('en-AU', { minimumFractionDigits: decimals === undefined ? 0 : d, maximumFractionDigits: d })
  return fixed === '-0' ? '0' : fixed
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a)
}

/** `whole` and a reduced fraction of `den` for a non-negative value: 3.5 over 8 gives { whole: 3, num: 4, den: 8 } reduced to 1/2. */
function splitFraction(value: number, den: number): { whole: number; num: number; den: number } {
  const total = Math.round(value * den)
  const whole = Math.floor(total / den)
  const n = total - whole * den
  if (!n) return { whole, num: 0, den: 1 }
  const g = gcd(n, den)
  return { whole, num: n / g, den: den / g }
}

/** 3.5 and 8 give "3 1/2"; 0.25 and 16 give "1/4"; 2 gives "2". */
export function fractionText(value: number, den: number): string {
  const sign = value < 0 ? '-' : ''
  const { whole, num, den: d } = splitFraction(Math.abs(value), den)
  if (!num) return `${sign}${whole}`
  return `${sign}${whole ? `${whole} ` : ''}${num}/${d}`
}

/** A length already in `unit`, for example 12.5 m, as text with units. */
export function formatQuantity(value: number, unit: string, precision?: Precision): string {
  if (unit === 'ft-in') {
    const sign = value < 0 ? '-' : ''
    const totalIn = Math.abs(value) * 12
    const den = precision && 'fraction' in precision ? precision.fraction : 0
    let feet = Math.floor(totalIn / 12 + 1e-9)
    const inches = totalIn - feet * 12
    let inText: string
    if (den) {
      // Round first so 11 15/16 + a bit carries into the next foot.
      const rounded = Math.round(inches * den) / den
      if (rounded >= 12) {
        feet += 1
        inText = '0'
      } else inText = fractionText(rounded, den)
    } else {
      const d = precision && 'decimals' in precision ? precision.decimals : 2
      const f = Number(inches.toFixed(d))
      if (f >= 12) {
        feet += 1
        inText = '0'
      } else inText = String(f)
    }
    return `${sign}${feet}' ${inText}"`
  }
  if (precision && 'fraction' in precision && isImperial(unit)) return `${fractionText(value, precision.fraction)} ${unit}`
  return `${decimal(value, precision && 'decimals' in precision ? precision.decimals : undefined)} ${unit}`
}

/** An area already in `unit`² (feet and inches count as feet). */
export function formatAreaQuantity(value: number, unit: string, precision?: Precision): string {
  const u = unit === 'ft-in' ? 'ft' : unit
  const decimals = precision && 'decimals' in precision ? precision.decimals : undefined
  return `${decimal(value, decimals)} ${u}²`
}

/** The unit name written into a PDF /Measure dictionary: feet and inches are written as feet. */
export const pdfUnit = (unit: string) => (unit === 'ft-in' ? 'ft' : unit)

/** Real-world result of a measurement, for the CSV and the list: length or area in the scale's own unit. */
export function quantityOf(kind: 'distance' | 'perimeter' | 'area', lengthPt: number, areaPt2: number, factor: number): number {
  return kind === 'area' ? areaPt2 * factor * factor : lengthPt * factor
}
