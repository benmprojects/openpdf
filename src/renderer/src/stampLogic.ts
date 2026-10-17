// Pure logic for the stamp palette: the built-in stamps, fields filled in when a stamp is placed (date, time, author,
// sequential number), numbering, search, recently used, placement geometry and the stamp collection file format.
// Nothing here touches the DOM, so it is covered by unit tests.

export const CAT_STANDARD = 'Standard business'
export const CAT_CONSTRUCTION = 'Construction'
export const CAT_SIGN = 'Sign here'
export const CAT_MINE = 'My stamps'
export const BUILTIN_CATEGORIES = [CAT_STANDARD, CAT_CONSTRUCTION, CAT_SIGN]

/** A stamp in the palette. Text stamps have a title and an optional detail line, both of which can hold fields. */
export interface StampDef {
  id: string
  name: string
  category: string
  kind: 'text' | 'image'
  /** Text stamp: the large line. Fields such as {date} are filled in when the stamp is placed. */
  title: string
  /** Text stamp: the small second line; may be empty. */
  detail: string
  /** `#rrggbb` */
  color: string
  /** Used by the {number} field: text before the number, digits to pad to, and the first number. */
  numberPrefix?: string
  numberDigits?: number
  numberStart?: number
  /** Image stamp: the picture (PNG or JPEG data: URL) and its pixel size. */
  image?: { dataUrl: string; width: number; height: number }
  /** Part of the program, not the user's: cannot be edited or deleted. */
  builtin?: boolean
}

const GREEN = '#1c8a3a'
const RED = '#e5322d'
const BLUE = '#1f5fd1'
const ORANGE = '#ff9a3c'
const PURPLE = '#7b3fe4'

const text = (id: string, category: string, title: string, color: string, detail = ''): StampDef => ({
  id: `builtin:${id}`,
  name: title.charAt(0) + title.slice(1).toLowerCase(),
  category,
  kind: 'text',
  title,
  detail,
  color,
  builtin: true
})

/** The stamps supplied with the program. Wording is a starting set; users make their own under "My stamps". */
export const BUILTIN_STAMPS: StampDef[] = [
  text('approved', CAT_STANDARD, 'APPROVED', GREEN),
  text('not-approved', CAT_STANDARD, 'NOT APPROVED', RED),
  text('draft', CAT_STANDARD, 'DRAFT', BLUE),
  text('final', CAT_STANDARD, 'FINAL', GREEN),
  text('confidential', CAT_STANDARD, 'CONFIDENTIAL', RED),
  text('for-comment', CAT_STANDARD, 'FOR COMMENT', BLUE),
  text('void', CAT_STANDARD, 'VOID', RED),
  text('received', CAT_STANDARD, 'RECEIVED', BLUE, '{date}'),
  text('reviewed', CAT_STANDARD, 'REVIEWED', GREEN, '{author}, {date}'),
  text('approved-for-construction', CAT_CONSTRUCTION, 'APPROVED FOR CONSTRUCTION', GREEN),
  text('for-construction', CAT_CONSTRUCTION, 'FOR CONSTRUCTION', GREEN),
  text('issued-for-tender', CAT_CONSTRUCTION, 'ISSUED FOR TENDER', BLUE),
  text('not-for-construction', CAT_CONSTRUCTION, 'NOT FOR CONSTRUCTION', RED),
  text('as-built', CAT_CONSTRUCTION, 'AS BUILT', BLUE),
  text('superseded', CAT_CONSTRUCTION, 'SUPERSEDED', RED),
  text('revised', CAT_CONSTRUCTION, 'REVISED', ORANGE, '{date}'),
  text('preliminary', CAT_CONSTRUCTION, 'PRELIMINARY', ORANGE),
  text('for-information-only', CAT_CONSTRUCTION, 'FOR INFORMATION ONLY', BLUE),
  text('checked', CAT_CONSTRUCTION, 'CHECKED', GREEN, '{author}, {date}'),
  text('sign-here', CAT_SIGN, 'SIGN HERE', PURPLE),
  text('initial-here', CAT_SIGN, 'INITIAL HERE', PURPLE),
  text('witness', CAT_SIGN, 'WITNESS', PURPLE, '{date}')
]

// ---- Fields -----------------------------------------------------------------------------------------------

export const DATE_FORMATS = ['DD/MM/YYYY', 'D MMM YYYY', 'D MMMM YYYY', 'YYYY-MM-DD', 'DD/MM/YY'] as const
export const TIME_FORMATS = ['HH:mm', 'h:mm a'] as const

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const p2 = (n: number) => String(n).padStart(2, '0')

/** Formats a date with YYYY YY MMMM MMM MM DD D tokens (anything else is kept). */
export function formatDate(fmt: string, d: Date): string {
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|DD|D/g, (t) => {
    switch (t) {
      case 'YYYY':
        return String(d.getFullYear())
      case 'YY':
        return p2(d.getFullYear() % 100)
      case 'MMMM':
        return MONTHS[d.getMonth()]
      case 'MMM':
        return MONTHS[d.getMonth()].slice(0, 3)
      case 'MM':
        return p2(d.getMonth() + 1)
      case 'DD':
        return p2(d.getDate())
      default:
        return String(d.getDate())
    }
  })
}

/** Formats a time with HH H hh h mm a tokens ("a" gives am or pm). */
export function formatTime(fmt: string, d: Date): string {
  const h12 = d.getHours() % 12 || 12
  return fmt.replace(/HH|H|hh|h|mm|a/g, (t) => {
    switch (t) {
      case 'HH':
        return p2(d.getHours())
      case 'H':
        return String(d.getHours())
      case 'hh':
        return p2(h12)
      case 'h':
        return String(h12)
      case 'mm':
        return p2(d.getMinutes())
      default:
        return d.getHours() < 12 ? 'am' : 'pm'
    }
  })
}

/** The number as shown: prefix, then the number padded with zeros to `digits`. */
export function formatNumber(prefix: string | undefined, n: number, digits = 1): string {
  return `${prefix ?? ''}${String(n).padStart(Math.max(1, Math.min(10, digits)), '0')}`
}

export interface FieldContext {
  author: string
  now: Date
  /** What {number} stands for, already formatted; {number} is left as it is when absent. */
  number?: string
}

const FIELD = /\{(date|time|author|number)(?::([^}]*))?\}/gi

/** Fills in {date}, {date:FORMAT}, {time}, {time:FORMAT}, {author} and {number}. Unknown {words} are kept. */
export function expandFields(template: string, ctx: FieldContext): string {
  return template.replace(FIELD, (whole, name: string, arg: string | undefined) => {
    switch (name.toLowerCase()) {
      case 'date':
        return formatDate(arg || DATE_FORMATS[0], ctx.now)
      case 'time':
        return formatTime(arg || TIME_FORMATS[0], ctx.now)
      case 'author':
        return ctx.author
      default:
        return ctx.number ?? whole
    }
  })
}

/** Whether the lines hold a {number} field (so placing the stamp uses up a number). */
export const usesNumber = (...lines: string[]) => lines.some((l) => /\{number\}/i.test(l))

/** Whether the lines hold any field. */
export const hasFields = (...lines: string[]) => lines.some((l) => new RegExp(FIELD.source, 'i').test(l))

/** Clean up what is left after fields are filled in: a comma left hanging when the author is empty, doubled spaces. */
export function tidyLine(s: string): string {
  return s
    .replace(/^[\s,;:-]+/, '')
    .replace(/\s+([,;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ---- Numbering --------------------------------------------------------------------------------------------

export type Counters = Record<string, number>

/**
 * Takes `count` consecutive numbers for a stamp. Returns the formatted numbers and the counters to keep; the input is
 * not changed. The first number is the stamp's start (1 if unset) until it has been used.
 */
export function takeNumbers(counters: Counters, def: Pick<StampDef, 'id' | 'numberPrefix' | 'numberDigits' | 'numberStart'>, count = 1): { numbers: string[]; counters: Counters } {
  const first = counters[def.id] ?? Math.max(0, Math.floor(def.numberStart ?? 1))
  const numbers: string[] = []
  for (let i = 0; i < count; i++) numbers.push(formatNumber(def.numberPrefix, first + i, def.numberDigits))
  return { numbers, counters: { ...counters, [def.id]: first + count } }
}

export interface Expanded {
  title: string
  detail: string
}

/** The two lines of a text stamp with its fields filled in. */
export function expandStamp(def: Pick<StampDef, 'title' | 'detail'>, ctx: FieldContext): Expanded {
  return { title: tidyLine(expandFields(def.title, ctx)), detail: tidyLine(expandFields(def.detail, ctx)) }
}

// ---- Palette ----------------------------------------------------------------------------------------------

/** Categories in display order: the built-in ones, then the user's own with "My stamps" last of the fixed ones. */
export function categoriesOf(stamps: StampDef[]): string[] {
  const extra = [...new Set(stamps.map((s) => s.category))].filter((c) => !BUILTIN_CATEGORIES.includes(c) && c !== CAT_MINE).sort((a, b) => a.localeCompare(b))
  return [...BUILTIN_CATEGORIES, ...extra, CAT_MINE]
}

/** Stamps whose name, wording or category contains every word typed. */
export function searchStamps(stamps: StampDef[], query: string): StampDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return stamps
  return stamps.filter((s) => {
    const hay = `${s.name} ${s.title} ${s.category}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export const MAX_RECENT = 8

/** Puts a stamp first in the recently used list. */
export function pushRecent(recent: string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, MAX_RECENT)
}

/** A name not already used in the category: "Name", "Name 2", "Name 3". */
export function uniqueName(name: string, taken: string[]): string {
  const base = name.trim() || 'Stamp'
  if (!taken.includes(base)) return base
  let i = 2
  while (taken.includes(`${base} ${i}`)) i++
  return `${base} ${i}`
}

// ---- Placement geometry -----------------------------------------------------------------------------------

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Smallest box holding `r` turned by `degrees` about its centre. */
export function rotatedBounds(r: Box, degrees: number): Box {
  const a = (degrees * Math.PI) / 180
  const c = Math.abs(Math.cos(a))
  const s = Math.abs(Math.sin(a))
  const w = r.w * c + r.h * s
  const h = r.w * s + r.h * c
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/** Normalises an angle to 0 up to (not including) 360. */
export const normAngle = (deg: number) => ((Math.round(deg) % 360) + 360) % 360

/** The largest box of the given shape (w : h) inside a dragged box, anchored at its top left. */
export function fitAspect(drag: { w: number; h: number }, aspect: number): { w: number; h: number } {
  if (!(aspect > 0)) return drag
  return drag.w / Math.max(1e-6, drag.h) > aspect ? { w: drag.h * aspect, h: drag.h } : { w: drag.w, h: drag.w / aspect }
}

/** Opacity limited to the range annotations accept. */
export const clampOpacity = (o: number) => Math.max(0.1, Math.min(1, o))

// ---- Collection file --------------------------------------------------------------------------------------

export const COLLECTION_FORMAT = 'openpdf-stamps'
const MAX_IMAGE_CHARS = 11 * 1024 * 1024
const DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/

/** A stamp as stored in a collection file: no ids, no built-in flag. */
export type CollectionStamp = Omit<StampDef, 'id' | 'builtin'>

/** Writes the user's stamps (not the built-in ones) as a collection file. */
export function serialiseCollection(stamps: StampDef[]): string {
  const out: CollectionStamp[] = stamps
    .filter((s) => !s.builtin)
    .map(({ id: _id, builtin: _b, ...rest }) => {
      void _id
      void _b
      return rest
    })
  return JSON.stringify({ format: COLLECTION_FORMAT, version: 1, stamps: out }, null, 2)
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Reads a collection file. Stamps that are not valid are counted and left out; a file that is not a collection throws. */
export function parseCollection(json: string): { stamps: CollectionStamp[]; skipped: number } {
  let data: unknown
  try {
    data = JSON.parse(json.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('That file is not a stamp collection.')
  }
  const d = data as { format?: unknown; version?: unknown; stamps?: unknown }
  if (!d || d.format !== COLLECTION_FORMAT || !Array.isArray(d.stamps)) throw new Error('That file is not an OpenPDF stamp collection.')
  if (typeof d.version === 'number' && d.version > 1) throw new Error('That collection was made by a newer version of OpenPDF.')
  const stamps: CollectionStamp[] = []
  let skipped = 0
  for (const raw of d.stamps as Record<string, unknown>[]) {
    const name = str(raw?.name, 80).trim()
    const kind = raw?.kind
    const color = typeof raw?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : '#1f5fd1'
    const category = str(raw?.category, 60).trim() || CAT_MINE
    if (!name || (kind !== 'text' && kind !== 'image')) {
      skipped++
      continue
    }
    if (kind === 'text') {
      const title = str(raw.title, 120).trim()
      if (!title) {
        skipped++
        continue
      }
      const digits = Number(raw.numberDigits)
      const start = Number(raw.numberStart)
      stamps.push({
        name,
        category,
        kind,
        title,
        detail: str(raw.detail, 160).trim(),
        color,
        ...(raw.numberPrefix ? { numberPrefix: str(raw.numberPrefix, 20) } : {}),
        ...(Number.isFinite(digits) && digits >= 1 ? { numberDigits: Math.min(10, Math.floor(digits)) } : {}),
        ...(Number.isFinite(start) && start >= 0 ? { numberStart: Math.floor(start) } : {})
      })
    } else {
      const img = raw.image as { dataUrl?: unknown; width?: unknown; height?: unknown } | undefined
      const url = typeof img?.dataUrl === 'string' ? img.dataUrl : ''
      const w = Number(img?.width)
      const h = Number(img?.height)
      if (!url || url.length > MAX_IMAGE_CHARS || !DATA_URL.test(url) || !(w >= 1) || !(h >= 1)) {
        skipped++
        continue
      }
      stamps.push({ name, category, kind, title: '', detail: '', color, image: { dataUrl: url, width: Math.floor(w), height: Math.floor(h) } })
    }
  }
  return { stamps, skipped }
}

// ---- Settings kept between sessions -----------------------------------------------------------------------

/** What is saved with the user's text stamps: recently used, and the next number of each numbered stamp. */
export interface StampMeta {
  texts: StampDef[]
  recent: string[]
  counters: Counters
}

export const emptyMeta = (): StampMeta => ({ texts: [], recent: [], counters: {} })

/** Reads saved stamp settings, ignoring anything malformed. */
export function parseMeta(json: string | null): StampMeta {
  if (!json) return emptyMeta()
  try {
    const d = JSON.parse(json) as Partial<StampMeta>
    const texts = (Array.isArray(d.texts) ? d.texts : []).filter(
      (s): s is StampDef => !!s && typeof s.id === 'string' && s.kind === 'text' && typeof s.name === 'string' && typeof s.title === 'string'
    )
    const counters: Counters = {}
    for (const [k, v] of Object.entries(d.counters ?? {})) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) counters[k] = Math.floor(v)
    return {
      texts: texts.map((s) => ({ ...s, detail: typeof s.detail === 'string' ? s.detail : '', category: s.category || CAT_MINE, color: /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#1f5fd1', builtin: undefined })),
      recent: (Array.isArray(d.recent) ? d.recent : []).filter((r): r is string => typeof r === 'string').slice(0, MAX_RECENT),
      counters
    }
  } catch {
    return emptyMeta()
  }
}

// ---- Placement options ------------------------------------------------------------------------------------

export interface StampOpts {
  /** Drag a box on the page to size the stamp; otherwise a click places it at its default size. */
  drag: boolean
  /** A dragged box keeps the stamp's own shape. */
  keepAspect: boolean
  /** Degrees clockwise, 0 up to 359. */
  angle: number
  /** 0.1 to 1. */
  opacity: number
}

export const DEFAULT_OPTS: StampOpts = { drag: false, keepAspect: true, angle: 0, opacity: 1 }
