import { app, nativeTheme, session } from 'electron'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPaperId } from '../shared/printPlan'
import { cleanMarkPresets, type MarkPreset } from '../shared/markPresets'

export type Theme = 'system' | 'dark' | 'light'

export interface Settings {
  theme: Theme
  /** Most recent first, at most RECENT_MAX paths. */
  recent: string[]
  /** Minutes between recovery snapshots of documents with unsaved changes; 0 turns it off. */
  autosaveMinutes: number
  /** Written as the author of new annotations. */
  author: string
  sidebarWidth: number
  /** Which side of the window the side pane docks to. */
  paneSide: 'left' | 'right'
  /** Underline misspelled words in text boxes and offer suggestions. */
  spellcheck: boolean
  /** Style each annotation tool starts with, by annotation kind (saved with "Make default"). */
  toolDefaults: Record<string, ToolStyle>
  /** Named tool presets: a kind and a style, shown in the Presets list. */
  toolPresets: ToolPreset[]
  /** Saved drawing scales for the Measure tab's Scale dialog. */
  scalePresets: ScalePreset[]
  /** Saved settings for the header and footer, page number, Bates, watermark and crop dialogs. */
  markPresets: MarkPreset[]
  /** Update checks: off unless turned on, and only to the address given. */
  updates: { check: boolean; feed: string }
  /** `system`, or a language code such as en-AU or fr. */
  language: string
  /** The printer last used in the Print dialog (its system name), and the paper size last chosen there. */
  printer: string
  printPaper: string
  /** Reopen the documents that were open when OpenPDF last closed. */
  restoreSession: boolean
  /** Paths of the saved documents that were open, in tab order, as of the last change. */
  lastSession: string[]
}

/** Mirrors ToolStyle in the renderer's annotations.ts. */
export interface ToolStyle {
  color?: string
  fill?: string
  dash?: 'dashed' | 'dotted'
  lineWidth?: number
  opacity?: number
  fontFamily?: 'Helvetica' | 'Times' | 'Courier'
  fontSize?: number
  lineStart?: LineEnd
  lineEnd?: LineEnd
  cloud?: number
  blend?: BlendMode
}

/** Mirrors LINE_ENDS and BLEND_MODES in the renderer (lineEnds.ts, annotations.ts). */
type LineEnd = 'None' | 'OpenArrow' | 'ClosedArrow' | 'ROpenArrow' | 'RClosedArrow' | 'Circle' | 'Square' | 'Diamond' | 'Slash' | 'Butt'
type BlendMode = 'Normal' | 'Multiply' | 'Screen' | 'Overlay' | 'Darken' | 'Lighten'
const LINE_ENDS: string[] = ['None', 'OpenArrow', 'ClosedArrow', 'ROpenArrow', 'RClosedArrow', 'Circle', 'Square', 'Diamond', 'Slash', 'Butt']
const BLEND_MODES: string[] = ['Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten']

/** Mirrors ScalePreset in the renderer's measureScale.ts. */
export interface ScalePreset {
  id: string
  name: string
  /** 1:`ratio`. */
  ratio: number
  unit: string
  decimals?: number
  fraction?: number
}

const SCALE_UNITS = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'ft-in', 'yd']

export interface ToolPreset {
  id: string
  name: string
  kind: string
  style: ToolStyle
}

const HEX = /^#[0-9a-f]{6}$/i
function cleanStyle(raw: unknown): ToolStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: ToolStyle = {}
  if (typeof r.color === 'string' && HEX.test(r.color)) out.color = r.color
  if (typeof r.fill === 'string' && HEX.test(r.fill)) out.fill = r.fill
  if (r.dash === 'dashed' || r.dash === 'dotted') out.dash = r.dash
  if (typeof r.lineWidth === 'number' && r.lineWidth > 0 && r.lineWidth <= 50) out.lineWidth = r.lineWidth
  if (typeof r.opacity === 'number' && r.opacity >= 0.1 && r.opacity <= 1) out.opacity = r.opacity
  if (r.fontFamily === 'Helvetica' || r.fontFamily === 'Times' || r.fontFamily === 'Courier') out.fontFamily = r.fontFamily
  if (typeof r.fontSize === 'number' && r.fontSize >= 4 && r.fontSize <= 144) out.fontSize = r.fontSize
  if (typeof r.lineStart === 'string' && LINE_ENDS.includes(r.lineStart)) out.lineStart = r.lineStart as LineEnd
  if (typeof r.lineEnd === 'string' && LINE_ENDS.includes(r.lineEnd)) out.lineEnd = r.lineEnd as LineEnd
  if (r.cloud === 0 || r.cloud === 1 || r.cloud === 2) out.cloud = r.cloud
  if (typeof r.blend === 'string' && BLEND_MODES.includes(r.blend)) out.blend = r.blend as BlendMode
  return out
}

const RECENT_MAX = 12

const defaults = (): Settings => ({
  theme: 'system',
  recent: [],
  autosaveMinutes: 2,
  author: process.env.USERNAME ?? process.env.USER ?? '',
  sidebarWidth: 220,
  paneSide: 'left',
  spellcheck: true,
  toolDefaults: {},
  toolPresets: [],
  scalePresets: [],
  markPresets: [],
  updates: { check: false, feed: '' },
  // Tests always start in Australian English, whatever the machine's language.
  language: process.env.OPENPDF_E2E === '1' ? 'en-AU' : 'system',
  printer: '',
  printPaper: 'A4',
  restoreSession: false,
  lastSession: []
})

let current: Settings | null = null
const file = () => join(app.getPath('userData'), 'settings.json')

/** Atomic write: a crash mid-write cannot leave a half-written settings file. */
async function writeJson(path: string, value: unknown) {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, path)
}

function sanitise(raw: Partial<Settings>): Settings {
  const d = defaults()
  return {
    theme: raw.theme === 'dark' || raw.theme === 'light' || raw.theme === 'system' ? raw.theme : d.theme,
    recent: Array.isArray(raw.recent) ? raw.recent.filter((p) => typeof p === 'string').slice(0, RECENT_MAX) : d.recent,
    autosaveMinutes:
      typeof raw.autosaveMinutes === 'number' && raw.autosaveMinutes >= 0 && raw.autosaveMinutes <= 60 ? raw.autosaveMinutes : d.autosaveMinutes,
    author: typeof raw.author === 'string' ? raw.author.slice(0, 200) : d.author,
    sidebarWidth: typeof raw.sidebarWidth === 'number' ? Math.min(600, Math.max(140, raw.sidebarWidth)) : d.sidebarWidth,
    paneSide: raw.paneSide === 'right' ? 'right' : 'left',
    spellcheck: typeof raw.spellcheck === 'boolean' ? raw.spellcheck : d.spellcheck,
    toolDefaults:
      raw.toolDefaults && typeof raw.toolDefaults === 'object'
        ? Object.fromEntries(
            Object.entries(raw.toolDefaults)
              .filter(([k]) => /^[a-z]{2,20}$/.test(k))
              .slice(0, 40)
              .map(([k, v]) => [k, cleanStyle(v)])
          )
        : {},
    toolPresets: Array.isArray(raw.toolPresets)
      ? raw.toolPresets
          .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.kind === 'string' && /^[a-z]{2,20}$/.test(p.kind))
          .slice(0, 100)
          .map((p) => ({ id: p.id.slice(0, 64), name: p.name.slice(0, 80), kind: p.kind, style: cleanStyle(p.style) }))
      : [],
    scalePresets: Array.isArray(raw.scalePresets)
      ? raw.scalePresets
          .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.ratio === 'number' && p.ratio > 0 && p.ratio < 1e7 && SCALE_UNITS.includes(p.unit))
          .slice(0, 100)
          .map((p) => ({
            id: p.id.slice(0, 64),
            name: p.name.slice(0, 80),
            ratio: p.ratio,
            unit: p.unit,
            ...(typeof p.fraction === 'number' && p.fraction >= 2 && p.fraction <= 64 ? { fraction: Math.round(p.fraction) } : typeof p.decimals === 'number' && p.decimals >= 0 && p.decimals <= 6 ? { decimals: Math.floor(p.decimals) } : {})
          }))
      : [],
    markPresets: cleanMarkPresets(raw.markPresets),
    updates: {
      check: typeof raw.updates?.check === 'boolean' ? raw.updates.check : false,
      feed: typeof raw.updates?.feed === 'string' ? raw.updates.feed.trim().slice(0, 300) : ''
    },
    language: typeof raw.language === 'string' && (raw.language === 'system' || /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(raw.language)) ? raw.language : 'system',
    printer: typeof raw.printer === 'string' ? raw.printer.slice(0, 300) : d.printer,
    printPaper: isPaperId(raw.printPaper) ? raw.printPaper : d.printPaper,
    restoreSession: typeof raw.restoreSession === 'boolean' ? raw.restoreSession : d.restoreSession,
    lastSession: Array.isArray(raw.lastSession) ? raw.lastSession.filter((p): p is string => typeof p === 'string' && p.length < 1000 && /\.pdf$/i.test(p)).slice(0, 30) : d.lastSession
  }
}

export async function loadSettings(): Promise<Settings> {
  if (current) return current
  try {
    current = sanitise(JSON.parse(await readFile(file(), 'utf8')))
  } catch {
    current = defaults()
  }
  nativeTheme.themeSource = current.theme
  applySpelling(current)
  return current
}

/** Turns the spell checker on or off, and prefers Australian English when the system has it. */
function applySpelling(s: Settings): void {
  try {
    const ses = session.defaultSession
    const available = ses.availableSpellCheckerLanguages
    const pick = ['en-AU', 'en-GB', 'en-US'].find((l) => available.includes(l))
    if (pick) ses.setSpellCheckerLanguages([pick])
    // Last: choosing a language can switch the checker back on.
    ses.setSpellCheckerEnabled(s.spellcheck)
  } catch {
    // No session yet (before the app is ready) or no dictionaries: the defaults stay.
  }
}

/** Writes happen one at a time, each saving the latest settings, so a slow older write cannot overwrite a newer one. */
let writing: Promise<void> = Promise.resolve()

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitise({ ...(await loadSettings()), ...patch })
  current = next
  nativeTheme.themeSource = next.theme
  applySpelling(next)
  writing = writing
    .catch(() => {})
    .then(async () => {
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeJson(file(), current ?? next)
    })
  await writing
  return next
}

export async function addRecent(path: string): Promise<void> {
  const s = await loadSettings()
  const lower = path.toLowerCase()
  await updateSettings({ recent: [path, ...s.recent.filter((p) => p.toLowerCase() !== lower)].slice(0, RECENT_MAX) })
}

export async function removeRecent(path: string): Promise<void> {
  const s = await loadSettings()
  await updateSettings({ recent: s.recent.filter((p) => p !== path) })
}

// ---- Crash recovery ---------------------------------------------------------------------------------
// While a document has unsaved changes the renderer sends a snapshot (annotations written in) every few
// minutes. A clean save or close removes it; after a crash the snapshots are offered back on the next start.

export interface RecoveryEntry {
  key: string
  name: string
  /** The file the document came from, if any. */
  path?: string
  time: number
}

const recoveryDir = () => join(app.getPath('userData'), 'recovery')
const safeKey = (key: string) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) throw new Error('Bad recovery key')
  return key
}

export async function saveRecovery(key: string, meta: { name: string; path?: string }, data: Uint8Array): Promise<void> {
  const dir = recoveryDir()
  await mkdir(dir, { recursive: true })
  const k = safeKey(key)
  await writeFile(join(dir, `${k}.pdf.tmp`), data)
  await rename(join(dir, `${k}.pdf.tmp`), join(dir, `${k}.pdf`))
  const entry: RecoveryEntry = { key: k, name: meta.name, path: meta.path, time: Date.now() }
  await writeJson(join(dir, `${k}.json`), entry)
}

export async function clearRecovery(key: string): Promise<void> {
  const k = safeKey(key)
  await rm(join(recoveryDir(), `${k}.pdf`), { force: true })
  await rm(join(recoveryDir(), `${k}.json`), { force: true })
}

export async function listRecovery(): Promise<RecoveryEntry[]> {
  let names: string[]
  try {
    names = await readdir(recoveryDir())
  } catch {
    return []
  }
  const out: RecoveryEntry[] = []
  for (const n of names.filter((n) => n.endsWith('.json'))) {
    try {
      const e = JSON.parse(await readFile(join(recoveryDir(), n), 'utf8')) as RecoveryEntry
      safeKey(e.key)
      out.push(e)
    } catch {
      // A damaged entry is skipped; clearAllRecovery removes it later.
    }
  }
  return out.sort((a, b) => b.time - a.time)
}

export async function readRecovery(key: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(recoveryDir(), `${safeKey(key)}.pdf`)))
}

export async function clearAllRecovery(): Promise<void> {
  await rm(recoveryDir(), { recursive: true, force: true })
}
