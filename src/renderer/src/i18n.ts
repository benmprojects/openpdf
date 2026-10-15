/**
 * Translation. The English (Australian) text is the key: `t('Open file')` returns the text as written unless the
 * chosen language has a translation for exactly that string, so an untranslated string is simply English and nothing
 * breaks when a catalogue is partial. Catalogues are JSON files `{ "name": "...", "messages": { "English": "..." } }`:
 * the ones bundled in `locales/`, and any in the user's `locales` folder (which override the bundled ones), so a
 * translation can be added without rebuilding the program. `{name}` placeholders are filled from the values given.
 */
import { useSyncExternalStore } from 'react'

export interface Catalogue {
  name: string
  messages: Record<string, string>
}

const BASE = 'en-AU'

const bundled = import.meta.glob<Catalogue>('./locales/*.json', { eager: true, import: 'default' })

const catalogues = new Map<string, Catalogue>()
for (const [path, cat] of Object.entries(bundled)) {
  const code = /\/([^/]+)\.json$/.exec(path)?.[1]
  if (code && !code.startsWith('_') && cat && typeof cat.name === 'string' && cat.messages) catalogues.set(code, cat)
}

let current = BASE
let messages: Record<string, string> = {}
const listeners = new Set<() => void>()

/** Adds catalogues from the user's folder (they replace bundled ones with the same code). */
export function addCatalogues(extra: Record<string, Catalogue>): void {
  for (const [code, cat] of Object.entries(extra)) catalogues.set(code, cat)
  setLanguage(current)
}

/** The languages available: the base one first, then the others by name. */
export function languages(): { code: string; name: string }[] {
  return [{ code: BASE, name: 'English (Australia)' }, ...[...catalogues].filter(([c]) => c !== BASE).map(([code, c]) => ({ code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))]
}

/** The best available language for a request: "system" means the one the browser reports. */
export function resolveLanguage(want: string, system = typeof navigator !== 'undefined' ? navigator.language : BASE): string {
  const ask = want === 'system' ? system : want
  if (ask === BASE || catalogues.has(ask)) return ask
  const lang = ask.split('-')[0].toLowerCase()
  const exact = [...catalogues.keys()].find((c) => c.toLowerCase() === ask.toLowerCase())
  if (exact) return exact
  const sameLanguage = [...catalogues.keys()].find((c) => c.split('-')[0].toLowerCase() === lang)
  return sameLanguage ?? BASE
}

export function setLanguage(want: string): void {
  current = resolveLanguage(want)
  messages = current === BASE ? {} : (catalogues.get(current)?.messages ?? {})
  if (typeof document !== 'undefined') document.documentElement.lang = current
  for (const l of listeners) l()
}

export const currentLanguage = () => current

/** Translates `text`, filling `{name}` placeholders from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const s = messages[text] ?? text
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

/** Marks a string for translation where it is written, without translating it there (it is translated where it is shown). */
export const msg = (text: string): string => text

/** "1 file" or "3 files": pick by the language's plural rules. `forms` has the English one and other forms. */
export function plural(n: number, forms: { one: string; other: string }, vars: Record<string, string | number> = {}): string {
  const rule = new Intl.PluralRules(current).select(n)
  return t(rule === 'one' ? forms.one : forms.other, { n, ...vars })
}

/** Dates and numbers in the chosen language. */
export const formatDate = (d: Date) => d.toLocaleDateString(current)
export const formatDateTime = (d: Date) => d.toLocaleString(current)

/** Re-renders a component when the language changes. */
export function useLanguage(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}
