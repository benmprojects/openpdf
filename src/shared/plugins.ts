/**
 * Plugins: what a manifest may say and what a plugin's script may ask for. A plugin runs as a sandboxed script that
 * reads a description of the document and returns steps from the batch vocabulary; the manifest lists which kinds of
 * step it may return (shown to the person who installs it), and anything else it returns is dropped. Pure: used by
 * both processes.
 */
import type { BatchStep } from '../renderer/src/batch'

/** Steps a plugin may be allowed to produce. Passwords, nested plugins and recognition are not among them. */
export const PLUGIN_STEP_KINDS = ['watermark', 'headerFooter', 'properties', 'rotate', 'flatten', 'sanitise', 'optimise', 'pdfa'] as const
export type PluginStepKind = (typeof PLUGIN_STEP_KINDS)[number]

export const PLUGIN_API_VERSION = 1

export interface PluginParam {
  id: string
  label: string
  default?: string
}

export interface PluginAction {
  id: string
  label: string
  /** A .js file in the plugin's folder. */
  script: string
  params?: PluginParam[]
}

export interface PluginManifest {
  apiVersion: number
  id: string
  name: string
  version: string
  author?: string
  description?: string
  /** The kinds of step this plugin may produce. */
  permits: PluginStepKind[]
  actions: PluginAction[]
}

const ID = /^[a-z0-9][a-z0-9._-]{2,63}$/
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/
const SCRIPT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.js$/

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined)

/** Checks a parsed manifest. Returns it cleaned, or the first problem in plain words. */
export function validateManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'plugin.json is not an object.' }
  const m = raw as Record<string, unknown>
  if (m.apiVersion !== PLUGIN_API_VERSION) return { ok: false, error: `This plugin is for plugin API version ${String(m.apiVersion)}; this program supports version ${PLUGIN_API_VERSION}.` }
  if (typeof m.id !== 'string' || !ID.test(m.id)) return { ok: false, error: 'The plugin id must be 3 to 64 lower-case letters, digits, dots, dashes or underscores.' }
  const name = str(m.name, 80)
  const version = str(m.version, 32)
  if (!name || !version) return { ok: false, error: 'The plugin needs a name and a version.' }
  const permits = Array.isArray(m.permits) ? m.permits : []
  if (!permits.length || !permits.every((p) => (PLUGIN_STEP_KINDS as readonly string[]).includes(p as string))) return { ok: false, error: `permits must list some of: ${PLUGIN_STEP_KINDS.join(', ')}.` }
  const actionsRaw = Array.isArray(m.actions) ? m.actions : []
  if (!actionsRaw.length || actionsRaw.length > 20) return { ok: false, error: 'A plugin needs between 1 and 20 actions.' }
  const actions: PluginAction[] = []
  for (const a of actionsRaw as Record<string, unknown>[]) {
    if (!a || typeof a.id !== 'string' || !SLUG.test(a.id)) return { ok: false, error: 'Each action needs an id of lower-case letters, digits, dashes or underscores.' }
    const label = str(a.label, 80)
    if (!label) return { ok: false, error: `Action ${a.id} needs a label.` }
    if (typeof a.script !== 'string' || !SCRIPT.test(a.script)) return { ok: false, error: `Action ${a.id}: the script must be a file name ending in .js, with no folders.` }
    const params: PluginParam[] = []
    for (const p of (Array.isArray(a.params) ? a.params : []).slice(0, 10) as Record<string, unknown>[]) {
      if (!p || typeof p.id !== 'string' || !SLUG.test(p.id)) return { ok: false, error: `Action ${a.id}: a parameter has no valid id.` }
      params.push({ id: p.id, label: str(p.label, 80) ?? p.id, default: str(p.default, 200) })
    }
    actions.push({ id: a.id, label, script: a.script, params })
  }
  if (new Set(actions.map((a) => a.id)).size !== actions.length) return { ok: false, error: 'Two actions have the same id.' }
  return { ok: true, manifest: { apiVersion: 1, id: m.id, name, version, author: str(m.author, 80), description: str(m.description, 400), permits: [...new Set(permits)] as PluginStepKind[], actions } }
}

// ---- What a script may return ---------------------------------------------------------------------------

const num = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const colour = (v: unknown, fallback: string): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback)
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback)

/** One step a plugin returned, cleaned and limited; null when it is not allowed or not understood. */
export function normaliseStep(raw: unknown, permits: readonly string[]): BatchStep | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const kind = s.kind
  if (typeof kind !== 'string' || !permits.includes(kind) || !(PLUGIN_STEP_KINDS as readonly string[]).includes(kind)) return null
  switch (kind) {
    case 'watermark': {
      const t = text(s.text, 200)
      return t.trim() ? { kind, text: t, fontSize: num(s.fontSize, 6, 300, 60), color: colour(s.color, '#cc0000'), opacity: num(s.opacity, 0.05, 1, 0.25), angle: num(s.angle, -90, 90, 45), behind: bool(s.behind) } : null
    }
    case 'headerFooter': {
      const slots: Partial<Record<'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br', string>> = {}
      const given = (s.slots && typeof s.slots === 'object' ? s.slots : {}) as Record<string, unknown>
      for (const k of ['tl', 'tc', 'tr', 'bl', 'bc', 'br'] as const) if (typeof given[k] === 'string' && (given[k] as string).trim()) slots[k] = text(given[k], 200)
      return Object.keys(slots).length ? { kind, slots, fontSize: num(s.fontSize, 5, 48, 9), color: colour(s.color, '#000000'), margin: num(s.margin, 0, 200, 24), startNumber: Math.round(num(s.startNumber, 0, 100000, 1)) } : null
    }
    case 'properties': {
      const out: BatchStep = { kind }
      for (const k of ['title', 'author', 'subject', 'keywords'] as const) if (typeof s[k] === 'string') out[k] = text(s[k], 500)
      return out
    }
    case 'rotate':
      return s.degrees === 90 || s.degrees === 180 || s.degrees === 270 ? { kind, degrees: s.degrees } : null
    case 'flatten':
      return { kind }
    case 'pdfa':
      return { kind }
    case 'optimise':
      return { kind, level: s.level === 'light' || s.level === 'small' ? s.level : 'standard' }
    case 'sanitise': {
      const o = (s.options && typeof s.options === 'object' ? s.options : {}) as Record<string, unknown>
      return { kind, options: { metadata: bool(o.metadata), attachments: bool(o.attachments), javascript: bool(o.javascript), comments: bool(o.comments), bookmarks: bool(o.bookmarks), thumbnails: bool(o.thumbnails) } }
    }
  }
  return null
}

export interface PluginOutcome {
  steps: BatchStep[]
  /** Shown to the person after the action ran. */
  message: string
  /** Steps the plugin returned that its manifest does not permit or that were not understood. */
  dropped: number
  error?: string
}

/** Turns what a script returned into steps the program will run. */
export function normaliseResult(raw: unknown, permits: readonly string[]): PluginOutcome {
  if (!raw || typeof raw !== 'object') return { steps: [], message: '', dropped: 0, error: 'The plugin returned nothing.' }
  const r = raw as Record<string, unknown>
  if (typeof r.error === 'string' && r.error) return { steps: [], message: '', dropped: 0, error: r.error.slice(0, 300) }
  const list = Array.isArray(r.steps) ? r.steps.slice(0, 20) : []
  const steps: BatchStep[] = []
  let dropped = 0
  for (const x of list) {
    const s = normaliseStep(x, permits)
    if (s) steps.push(s)
    else dropped++
  }
  return { steps, message: text(r.message, 400), dropped }
}
