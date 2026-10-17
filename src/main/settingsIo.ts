import type { Settings } from './settings'

/**
 * Settings that move between computers. Left out on purpose: the recent files and last session (they name local
 * files), the printer (it is installed on one machine), the update address and the launch applications (trust decisions for
 * each machine: they name programs on this computer).
 */
export const PORTABLE_KEYS = [
  'theme',
  'language',
  'author',
  'autosaveMinutes',
  'sidebarWidth',
  'paneSide',
  'spellcheck',
  'restoreSession',
  'printPaper',
  'toolDefaults',
  'toolPresets',
  'scalePresets',
  'markPresets',
  'securityPolicies',
  'viewDefaults',
  'searchProviders',
  'identity',
  'performance',
  'quickAccess',
  'ribbonLayout',
  'presentation'
] as const satisfies readonly (keyof Settings)[]

export type PortableKey = (typeof PORTABLE_KEYS)[number]

const FORMAT = 'openpdf-settings'

/** The settings file written by Export: the portable settings, and a marker so other JSON is not taken for it. */
export function exportSettings(s: Settings): string {
  const settings: Record<string, unknown> = {}
  for (const k of PORTABLE_KEYS) settings[k] = s[k]
  return JSON.stringify({ format: FORMAT, version: 1, settings }, null, 2) + '\n'
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Quick type checks per key; the settings store then cleans the values in detail (ranges, colours, lists). */
const GUARDS: Record<PortableKey, (v: unknown) => boolean> = {
  theme: (v) => v === 'system' || v === 'dark' || v === 'light',
  language: (v) => typeof v === 'string',
  author: (v) => typeof v === 'string',
  autosaveMinutes: (v) => typeof v === 'number',
  sidebarWidth: (v) => typeof v === 'number',
  paneSide: (v) => v === 'left' || v === 'right',
  spellcheck: (v) => typeof v === 'boolean',
  restoreSession: (v) => typeof v === 'boolean',
  printPaper: (v) => typeof v === 'string',
  toolDefaults: isObject,
  toolPresets: Array.isArray,
  scalePresets: Array.isArray,
  securityPolicies: Array.isArray,
  markPresets: Array.isArray,
  viewDefaults: isObject,
  searchProviders: Array.isArray,
  identity: isObject,
  performance: isObject,
  quickAccess: Array.isArray,
  ribbonLayout: isObject,
  presentation: isObject
}

export type ImportCheck = { ok: true; patch: Partial<Settings>; skipped: string[] } | { ok: false; error: string }

/** Reads a settings file. Unknown keys and values of the wrong kind are skipped and named; nothing else is touched. */
export function parseSettingsImport(text: string): ImportCheck {
  let data: unknown
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return { ok: false, error: 'That file is not a settings file (it is not valid JSON).' }
  }
  if (!isObject(data) || data.format !== FORMAT || !isObject(data.settings)) return { ok: false, error: 'That file is not an OpenPDF settings file.' }
  const patch: Record<string, unknown> = {}
  const skipped: string[] = []
  for (const [k, v] of Object.entries(data.settings)) {
    if ((PORTABLE_KEYS as readonly string[]).includes(k) && GUARDS[k as PortableKey](v)) patch[k] = v
    else skipped.push(k)
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'That settings file has no settings OpenPDF can use.' }
  return { ok: true, patch: patch as Partial<Settings>, skipped }
}
