/**
 * Preferences kept in Settings beyond the basics: page display defaults, search providers, identity, launch
 * applications, performance, the quick-access toolbar, ribbon layout and presentation options. Everything here is
 * plain data cleaned on the way in (the settings file and an imported settings file are not trusted), so the main
 * process and the renderer share one definition. No Electron or DOM code.
 */

// ---- Page display defaults ------------------------------------------------------------------------------

export type DefaultZoom = 'fit-width' | 'fit-page' | 'fit-visible' | 'actual'
export const DEFAULT_ZOOMS: DefaultZoom[] = ['fit-width', 'fit-page', 'fit-visible', 'actual']

export interface ViewDefaults {
  /** Two pages per row. */
  twoUp: boolean
  /** Every page in one scrolling column. */
  continuous: boolean
  /** With two pages: the first page alone. */
  cover: boolean
  /** Right-to-left page order. */
  rtl: boolean
  /** Space between pages. */
  gaps: boolean
  /** Thin lines drawn crisp, one pixel wide at the least. */
  thinLines: boolean
  /** How a document opens: fit width, fit page, fit visible or 100 %. */
  zoom: DefaultZoom
}

export const defaultViewDefaults = (): ViewDefaults => ({ twoUp: false, continuous: true, cover: false, rtl: false, gaps: true, thinLines: false, zoom: 'fit-width' })

const flag = (r: Record<string, unknown>, k: string, d: boolean) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : d)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function cleanViewDefaults(raw: unknown): ViewDefaults {
  const r = obj(raw)
  const d = defaultViewDefaults()
  return {
    twoUp: flag(r, 'twoUp', d.twoUp),
    continuous: flag(r, 'continuous', d.continuous),
    cover: flag(r, 'cover', d.cover),
    rtl: flag(r, 'rtl', d.rtl),
    gaps: flag(r, 'gaps', d.gaps),
    thinLines: flag(r, 'thinLines', d.thinLines),
    zoom: (DEFAULT_ZOOMS as unknown[]).includes(r.zoom) ? (r.zoom as DefaultZoom) : d.zoom
  }
}

// ---- Search providers -----------------------------------------------------------------------------------

export interface SearchProvider {
  id: string
  name: string
  /** A web address with {q} where the selected text goes. */
  url: string
}

export const defaultSearchProviders = (): SearchProvider[] => [
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search={q}' }
]

/** A provider address is acceptable when it is https (the search words travel in it) and carries the {q} placeholder. */
export function validProviderUrl(url: string): boolean {
  if (!url.includes('{q}') || url.length > 400) return false
  try {
    const u = new URL(url.replace('{q}', 'x'))
    return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname
  } catch {
    return false
  }
}

export function cleanSearchProviders(raw: unknown, fallback: SearchProvider[] = []): SearchProvider[] {
  if (!Array.isArray(raw)) return fallback
  const out: SearchProvider[] = []
  const seen = new Set<string>()
  for (const p of raw) {
    const r = obj(p)
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.url !== 'string') continue
    const id = r.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
    const name = r.name.trim().slice(0, 60)
    const url = r.url.trim()
    if (!id || !name || seen.has(id) || !validProviderUrl(url)) continue
    seen.add(id)
    out.push({ id, name, url })
    if (out.length >= 12) break
  }
  return out
}

/** The address to open for some selected text (collapsed to one line, at most 300 characters). */
export function searchUrl(provider: SearchProvider, text: string): string {
  const q = text.replace(/\s+/g, ' ').trim().slice(0, 300)
  return provider.url.replace('{q}', encodeURIComponent(q))
}

// ---- Identity -------------------------------------------------------------------------------------------

export interface Identity {
  initials: string
  email: string
  organisation: string
  title: string
}

export const defaultIdentity = (): Identity => ({ initials: '', email: '', organisation: '', title: '' })

export function cleanIdentity(raw: unknown): Identity {
  const r = obj(raw)
  const text = (k: string, max: number) => (typeof r[k] === 'string' ? (r[k] as string).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '')
  return { initials: text('initials', 10), email: text('email', 120), organisation: text('organisation', 120), title: text('title', 80) }
}

/** Initials from a full name ("Test User" gives "TU"), used when none are set. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('')
}

// ---- Launch applications --------------------------------------------------------------------------------

export interface LaunchApp {
  id: string
  /** What it is for, shown in the list. */
  name: string
  /** File extensions it opens, lower case, without dots. */
  extensions: string[]
  /** Full path of the program (an .exe on a drive letter). */
  path: string
}

const EXE_PATH = /^[A-Za-z]:\\[^<>"|?*\r\n]{1,240}\.exe$/i

export const validExePath = (p: string): boolean => EXE_PATH.test(p) && !p.includes('..')

/** "docx, xlsx" into ['docx', 'xlsx']: lower case, letters and digits, at most eight characters each. */
export function parseExtensions(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[\s,;]+/)) {
    const e = part.replace(/^\./, '').toLowerCase()
    if (/^[a-z0-9]{1,8}$/.test(e) && !out.includes(e)) out.push(e)
  }
  return out.slice(0, 20)
}

export function cleanLaunchApps(raw: unknown): LaunchApp[] {
  if (!Array.isArray(raw)) return []
  const out: LaunchApp[] = []
  const seen = new Set<string>()
  for (const a of raw) {
    const r = obj(a)
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.path !== 'string') continue
    const id = r.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
    const exts = Array.isArray(r.extensions) ? parseExtensions(r.extensions.filter((e): e is string => typeof e === 'string').join(' ')) : []
    if (!id || seen.has(id) || !r.name.trim() || !exts.length || !validExePath(r.path)) continue
    seen.add(id)
    out.push({ id, name: r.name.trim().slice(0, 60), extensions: exts, path: r.path })
    if (out.length >= 30) break
  }
  return out
}

/** The program chosen for a file name, by its extension (the first entry that lists it). */
export function appFor(apps: LaunchApp[], fileName: string): LaunchApp | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return null
  const ext = fileName.slice(dot + 1).toLowerCase()
  return apps.find((a) => a.extensions.includes(ext)) ?? null
}

// ---- Performance ----------------------------------------------------------------------------------------

export interface Performance {
  /** A page whose bitmap would pass this many megapixels is drawn in tiles. */
  tileMegapixels: number
  /** Pixels either side of the view that are drawn ahead of scrolling. */
  renderAhead: number
  /** Pages drawn at the same time. */
  renderJobs: number
}

export const defaultPerformance = (): Performance => ({ tileMegapixels: 16, renderAhead: 600, renderJobs: 2 })

const clampInt = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d)

export function cleanPerformance(raw: unknown): Performance {
  const r = obj(raw)
  const d = defaultPerformance()
  return {
    tileMegapixels: clampInt(r.tileMegapixels, 4, 64, d.tileMegapixels),
    renderAhead: clampInt(r.renderAhead, 0, 2400, d.renderAhead),
    renderJobs: clampInt(r.renderJobs, 1, 4, d.renderJobs)
  }
}

// ---- Quick-access toolbar -------------------------------------------------------------------------------

export const QUICK_ACCESS_MAX = 14
export const DEFAULT_QUICK_ACCESS = ['open', 'save', 'print', 'undo', 'redo']

export function cleanQuickAccess(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_QUICK_ACCESS]
  const out: string[] = []
  for (const id of raw) if (typeof id === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(id) && !out.includes(id)) out.push(id)
  return out.slice(0, QUICK_ACCESS_MAX)
}

/** Adds a command (when there is room and it is not there) or takes it away. */
export function toggleQuickAccess(list: string[], id: string): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id)
  return list.length >= QUICK_ACCESS_MAX ? list : [...list, id]
}

/** Moves the item at `index` one place earlier (dir -1) or later (dir 1). */
export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const out = [...list]
  ;[out[index], out[to]] = [out[to], out[index]]
  return out
}

// ---- Ribbon layout --------------------------------------------------------------------------------------

export interface RibbonLayout {
  /** Tab ids in the order to show them; tabs not listed follow in their usual order. */
  tabOrder: string[]
  /** Tabs left out of the ribbon. */
  hiddenTabs: string[]
  /** Groups left out, as `tab/Group name` in English. */
  hiddenGroups: string[]
}

export const defaultRibbonLayout = (): RibbonLayout => ({ tabOrder: [], hiddenTabs: [], hiddenGroups: [] })

const idList = (v: unknown, max: number, re: RegExp): string[] => {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) if (typeof x === 'string' && re.test(x) && !out.includes(x)) out.push(x)
  return out.slice(0, max)
}

export function cleanRibbonLayout(raw: unknown): RibbonLayout {
  const r = obj(raw)
  return {
    tabOrder: idList(r.tabOrder, 30, /^[a-z][a-z0-9-]{0,30}$/),
    hiddenTabs: idList(r.hiddenTabs, 30, /^[a-z][a-z0-9-]{0,30}$/),
    hiddenGroups: idList(r.hiddenGroups, 200, /^[a-z][a-z0-9-]{0,30}\/[^\r\n]{1,60}$/)
  }
}

/** The tabs to show, in order: the saved order first, the rest as they are, hidden ones left out. File stays: it holds Open and Save. */
export function visibleTabs<T extends { id: string }>(all: T[], layout: RibbonLayout, keep: string[] = ['file']): T[] {
  const rank = (id: string) => {
    const i = layout.tabOrder.indexOf(id)
    return i < 0 ? layout.tabOrder.length + all.findIndex((t) => t.id === id) : i
  }
  return [...all].sort((a, b) => rank(a.id) - rank(b.id)).filter((t) => keep.includes(t.id) || !layout.hiddenTabs.includes(t.id))
}

export const groupKey = (tab: string, label: string) => `${tab}/${label}`

// ---- Presentation ---------------------------------------------------------------------------------------

export const TRANSITIONS = ['none', 'fade', 'push', 'wipe', 'zoom', 'document'] as const
export type TransitionChoice = (typeof TRANSITIONS)[number]

export interface PresentationPrefs {
  transition: TransitionChoice
  /** Seconds before the next page when it advances by itself; 0 turns that off. */
  seconds: number
  /** Start again after the last page. */
  loop: boolean
}

export const defaultPresentation = (): PresentationPrefs => ({ transition: 'none', seconds: 0, loop: false })

export function cleanPresentation(raw: unknown): PresentationPrefs {
  const r = obj(raw)
  const d = defaultPresentation()
  return {
    transition: (TRANSITIONS as readonly unknown[]).includes(r.transition) ? (r.transition as TransitionChoice) : d.transition,
    seconds: clampInt(r.seconds, 0, 600, d.seconds),
    loop: flag(r, 'loop', d.loop)
  }
}

// ---- Floating pane --------------------------------------------------------------------------------------

export interface FloatPane {
  /** The side pane floats over the page instead of docking. */
  floating: boolean
  /** Position of its top left corner in the content area, and its size, in pixels. */
  x: number
  y: number
  w: number
  h: number
}

export const defaultFloatPane = (): FloatPane => ({ floating: false, x: 60, y: 150, w: 300, h: 420 })

export function cleanFloatPane(raw: unknown): FloatPane {
  const r = obj(raw)
  const d = defaultFloatPane()
  return { floating: flag(r, 'floating', false), x: clampInt(r.x, 0, 4000, d.x), y: clampInt(r.y, 0, 3000, d.y), w: clampInt(r.w, 200, 900, d.w), h: clampInt(r.h, 160, 1200, d.h) }
}
