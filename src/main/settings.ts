import { app, nativeTheme } from 'electron'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
}

const RECENT_MAX = 12

const defaults = (): Settings => ({
  theme: 'system',
  recent: [],
  autosaveMinutes: 2,
  author: process.env.USERNAME ?? process.env.USER ?? '',
  sidebarWidth: 220
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
    sidebarWidth: typeof raw.sidebarWidth === 'number' ? Math.min(600, Math.max(140, raw.sidebarWidth)) : d.sidebarWidth
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
  return current
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitise({ ...(await loadSettings()), ...patch })
  current = next
  nativeTheme.themeSource = next.theme
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeJson(file(), next)
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
