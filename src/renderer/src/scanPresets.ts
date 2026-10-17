/** Named scan settings: built-in ones and the user's own, kept in local storage. Pure apart from the injected storage. */
import type { ScanOptions } from '../../main/scan'

export interface ScanPreset {
  name: string
  source: ScanOptions['source']
  /** A particular scanner; empty for the first one found. */
  deviceId?: string
  dpi: ScanOptions['dpi']
  color: ScanOptions['color']
  paper: NonNullable<ScanOptions['paper']>
  duplex: boolean
  deskew: boolean
  despeckle: boolean
  autoCrop: boolean
  ocr: boolean
  ocrLanguages: string[]
}

export const STORAGE_KEY = 'openpdf.scanPresets'

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const SOURCES = ['dialog', 'flatbed', 'feeder']
const DPIS = [100, 150, 200, 300, 600]
const COLOURS = ['color', 'gray', 'bw']
export const PAPERS = ['auto', 'a4', 'a5', 'a3', 'letter', 'legal'] as const

/** Presets that come with the program; they cannot be deleted or replaced. */
export const BUILT_IN_PRESETS: ScanPreset[] = [
  { name: 'Document, black and white, 300 dpi', source: 'feeder', dpi: 300, color: 'bw', paper: 'auto', duplex: false, deskew: true, despeckle: true, autoCrop: false, ocr: true, ocrLanguages: ['eng'] },
  { name: 'Document, greyscale, 200 dpi', source: 'flatbed', dpi: 200, color: 'gray', paper: 'auto', duplex: false, deskew: true, despeckle: false, autoCrop: false, ocr: true, ocrLanguages: ['eng'] },
  { name: 'Photo, colour, 600 dpi', source: 'flatbed', dpi: 600, color: 'color', paper: 'auto', duplex: false, deskew: false, despeckle: false, autoCrop: true, ocr: false, ocrLanguages: ['eng'] },
  { name: 'Receipt, greyscale, 300 dpi', source: 'flatbed', dpi: 300, color: 'gray', paper: 'auto', duplex: false, deskew: true, despeckle: true, autoCrop: true, ocr: true, ocrLanguages: ['eng'] }
]

const isBuiltIn = (name: string) => BUILT_IN_PRESETS.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())

/** One preset from untrusted data, or null when it is not usable. Missing or invalid fields take defaults. */
export function cleanPreset(v: unknown): ScanPreset | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : ''
  if (!name) return null
  const langs = Array.isArray(o.ocrLanguages) ? o.ocrLanguages.filter((l): l is string => typeof l === 'string' && /^[a-z_]{2,12}$/i.test(l)).slice(0, 2) : []
  const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d)
  const p: ScanPreset = {
    name,
    source: SOURCES.includes(o.source as string) ? (o.source as ScanPreset['source']) : 'dialog',
    dpi: DPIS.includes(o.dpi as number) ? (o.dpi as ScanPreset['dpi']) : 200,
    color: COLOURS.includes(o.color as string) ? (o.color as ScanPreset['color']) : 'color',
    paper: (PAPERS as readonly unknown[]).includes(o.paper) ? (o.paper as ScanPreset['paper']) : 'auto',
    duplex: bool(o.duplex, false),
    deskew: bool(o.deskew, false),
    despeckle: bool(o.despeckle, false),
    autoCrop: bool(o.autoCrop, false),
    ocr: bool(o.ocr, true),
    ocrLanguages: langs.length ? langs : ['eng']
  }
  if (typeof o.deviceId === 'string' && o.deviceId) p.deviceId = o.deviceId.slice(0, 500)
  return p
}

/** The user's presets from stored text; junk, duplicates and names that clash with a built-in one are ignored. */
export function parsePresets(text: string | null | undefined): ScanPreset[] {
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: ScanPreset[] = []
  for (const r of raw) {
    const p = cleanPreset(r)
    if (!p || isBuiltIn(p.name) || out.some((q) => q.name.toLowerCase() === p.name.toLowerCase())) continue
    out.push(p)
  }
  return out
}

export const serialisePresets = (list: ScanPreset[]) => JSON.stringify(list)

/** Adds a preset, or replaces the one with the same name (ignoring case). A built-in name cannot be used. */
export function savePreset(list: ScanPreset[], preset: ScanPreset): { list: ScanPreset[]; error: string | null } {
  const p = cleanPreset(preset)
  if (!p) return { list, error: 'Enter a name for the preset.' }
  if (isBuiltIn(p.name)) return { list, error: 'That name is used by a built-in preset. Choose another.' }
  const i = list.findIndex((q) => q.name.toLowerCase() === p.name.toLowerCase())
  if (i < 0) return { list: [...list, p], error: null }
  const next = list.slice()
  next[i] = p
  return { list: next, error: null }
}

export function deletePreset(list: ScanPreset[], name: string): ScanPreset[] {
  return list.filter((p) => p.name !== name)
}

export function loadPresets(store: KeyValueStore | undefined = defaultStore()): ScanPreset[] {
  try {
    return parsePresets(store?.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

export function storePresets(list: ScanPreset[], store: KeyValueStore | undefined = defaultStore()): void {
  try {
    store?.setItem(STORAGE_KEY, serialisePresets(list))
  } catch {
    // Storage full or blocked: the presets last until the dialog closes.
  }
}

function defaultStore(): KeyValueStore | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

/** Every preset to choose from, built-in first. */
export const allPresets = (user: ScanPreset[]): ScanPreset[] => [...BUILT_IN_PRESETS, ...user]
