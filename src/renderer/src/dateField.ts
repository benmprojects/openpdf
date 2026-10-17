/**
 * Date fields: a text field with an AFDate format script. Filling shows a date picker; the date it gives is written in
 * the field's own date form (dd/mm/yyyy and so on), so the format script reads it back.
 */
import type { FormField } from './forms'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The date form of a field whose format script is AFDate_FormatEx("..."), or null for any other field. */
export function dateFormatOf(f: Pick<FormField, 'type' | 'scripts'>): string | null {
  if (f.type !== 'text') return null
  const m = /^\s*AFDate_FormatEx\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\)\s*;?\s*$/.exec(f.scripts?.format ?? '')
  if (!m) return null
  try {
    return m[1].startsWith('"') ? (JSON.parse(m[1]) as string) : m[1].slice(1, -1)
  } catch {
    return null
  }
}

const TOKEN = /dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy/g

const two = (n: number) => String(n).padStart(2, '0')

/** A date written in a form such as `dd/mm/yyyy`, `d mmm yyyy` or `dddd d mmmm yyyy`. */
export function formatDate(d: Date, form: string): string {
  return form.replace(TOKEN, (t) => {
    switch (t) {
      case 'd':
        return String(d.getDate())
      case 'dd':
        return two(d.getDate())
      case 'ddd':
        return DAYS[d.getDay()].slice(0, 3)
      case 'dddd':
        return DAYS[d.getDay()]
      case 'm':
        return String(d.getMonth() + 1)
      case 'mm':
        return two(d.getMonth() + 1)
      case 'mmm':
        return MONTHS[d.getMonth()].slice(0, 3)
      case 'mmmm':
        return MONTHS[d.getMonth()]
      case 'yy':
        return two(d.getFullYear() % 100)
      default:
        return String(d.getFullYear())
    }
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Reads text written in `form` back to a date (local time, noon, so no time zone shifts the day); null if it does not fit. */
export function parseDate(text: string, form: string): Date | null {
  const order: string[] = []
  let re = ''
  let last = 0
  for (const m of form.matchAll(TOKEN)) {
    re += escapeRe(form.slice(last, m.index)).replace(/\s+/g, '\\s*')
    last = m.index + m[0].length
    order.push(m[0])
    re += m[0] === 'yyyy' ? '(\\d{4})' : m[0] === 'yy' ? '(\\d{2})' : m[0].startsWith('mmm') || m[0].startsWith('ddd') ? '([A-Za-z]+)' : '(\\d{1,2})'
  }
  re += escapeRe(form.slice(last)).replace(/\s+/g, '\\s*')
  const hit = new RegExp(`^\\s*${re}\\s*$`).exec(text)
  if (!hit) return null
  let y: number | undefined
  let mo: number | undefined
  let day: number | undefined
  order.forEach((t, i) => {
    const v = hit[i + 1]
    if (t === 'yyyy') y = Number(v)
    else if (t === 'yy') y = Number(v) < 50 ? 2000 + Number(v) : 1900 + Number(v)
    else if (t === 'm' || t === 'mm') mo = Number(v) - 1
    else if (t === 'mmm' || t === 'mmmm') {
      const k = MONTHS.findIndex((n) => n.toLowerCase() === v.toLowerCase() || n.slice(0, 3).toLowerCase() === v.toLowerCase())
      if (k >= 0) mo = k
    } else if (t === 'd' || t === 'dd') day = Number(v)
  })
  if (y === undefined || mo === undefined || day === undefined) return null
  const d = new Date(y, mo, day, 12)
  return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === day ? d : null
}

/** yyyy-mm-dd, the value a date input uses. */
export const toInputValue = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`

/** A date input's yyyy-mm-dd back to a date, or null when empty. */
export function fromInputValue(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null
}
