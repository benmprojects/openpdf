/**
 * Installed plugins: a folder per plugin under the user's data folder, each with a plugin.json and its script files.
 * Installing checks the manifest and the files (names, sizes, no paths that leave the folder) and keeps only what
 * the manifest names. A catalogue is a JSON list of plugins with download addresses and checksums; downloads are
 * verified against the checksum before anything is installed.
 */
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { validateManifest, type PluginManifest } from '../shared/plugins'

const MAX_SCRIPT = 256 * 1024
const MAX_ZIP_FILES = 60
const MAX_ZIP_BYTES = 4 * 1024 * 1024

export interface InstalledPlugin {
  manifest: PluginManifest
  /** The script of each action, by action id. */
  scripts: Record<string, string>
}

export interface CatalogueEntry {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  /** Where the .zip is (https, or http on this computer for testing). */
  url: string
  /** Hex SHA-256 of the .zip. */
  sha256: string
  permits?: string[]
}

async function readPlugin(dir: string): Promise<InstalledPlugin> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8'))
  } catch {
    throw new Error('There is no readable plugin.json in that folder.')
  }
  const v = validateManifest(raw)
  if (!v.ok) throw new Error(v.error)
  const scripts: Record<string, string> = {}
  for (const a of v.manifest.actions) {
    const file = join(dir, a.script)
    const s = await stat(file).catch(() => null)
    if (!s?.isFile()) throw new Error(`The script ${a.script} for action ${a.id} is missing.`)
    if (s.size > MAX_SCRIPT) throw new Error(`The script ${a.script} is too large (over 256 KB).`)
    scripts[a.id] = await readFile(file, 'utf8')
  }
  return { manifest: v.manifest, scripts }
}

/** Plugins installed under `root`, those with a problem left out. */
export async function listPlugins(root: string): Promise<InstalledPlugin[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const out: InstalledPlugin[] = []
  for (const n of names.sort()) {
    try {
      out.push(await readPlugin(join(root, n)))
    } catch {
      // a broken plugin folder is skipped
    }
  }
  return out
}

/** Copies a checked plugin into `root/<id>`, replacing an older version. */
async function place(root: string, from: string, p: InstalledPlugin): Promise<PluginManifest> {
  await mkdir(root, { recursive: true })
  const target = join(root, p.manifest.id)
  const staging = `${target}.installing`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  // Only the manifest and the scripts it names are kept.
  await cp(join(from, 'plugin.json'), join(staging, 'plugin.json'))
  for (const a of p.manifest.actions) await cp(join(from, a.script), join(staging, a.script))
  await rm(target, { recursive: true, force: true })
  await rename(staging, target)
  return p.manifest
}

/** Installs the plugin in a folder. */
export async function installFromFolder(root: string, folder: string): Promise<PluginManifest> {
  return place(root, folder, await readPlugin(folder))
}

/** Installs a plugin from a .zip (the manifest at its top level, or inside one folder). */
export async function installFromZip(root: string, data: Uint8Array): Promise<PluginManifest> {
  if (data.length > MAX_ZIP_BYTES) throw new Error('That plugin file is too large (over 4 MB).')
  const zip = await JSZip.loadAsync(data).catch(() => {
    throw new Error('That file is not a valid zip.')
  })
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  if (entries.length > MAX_ZIP_FILES) throw new Error('That plugin has too many files.')
  for (const e of entries) {
    if (e.name.includes('..') || e.name.startsWith('/') || /^[A-Za-z]:/.test(e.name) || e.name.includes('\\')) throw new Error('That plugin contains an unsafe file path.')
  }
  const manifest = entries.find((e) => /(^|\/)plugin\.json$/.test(e.name))
  if (!manifest) throw new Error('There is no plugin.json in that zip.')
  const prefix = manifest.name.slice(0, manifest.name.length - 'plugin.json'.length)
  const dir = await mkdtemp(join(tmpdir(), 'openpdf-plugin-'))
  try {
    let total = 0
    for (const e of entries) {
      if (!e.name.startsWith(prefix) || e.name.slice(prefix.length).includes('/')) continue
      const buf = await e.async('nodebuffer')
      total += buf.length
      if (total > MAX_ZIP_BYTES) throw new Error('That plugin is too large once unpacked.')
      await writeFile(join(dir, e.name.slice(prefix.length)), buf)
    }
    return await installFromFolder(root, dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function uninstallPlugin(root: string, id: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(id)) throw new Error('Invalid plugin id')
  await rm(join(root, id), { recursive: true, force: true })
}

// ---- Catalogue -------------------------------------------------------------------------------------------

const allowedUrl = (u: string): boolean => {
  try {
    const url = new URL(u)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch {
    return false
  }
}

export async function fetchCatalogue(url: string, fetcher: typeof fetch): Promise<CatalogueEntry[]> {
  if (!allowedUrl(url)) throw new Error('The catalogue address must start with https:// (or be on this computer).')
  const res = await fetcher(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`The catalogue server answered ${res.status}.`)
  const json = (await res.json().catch(() => null)) as { plugins?: unknown } | null
  if (!json || !Array.isArray(json.plugins)) throw new Error('That is not a plugin catalogue.')
  const out: CatalogueEntry[] = []
  for (const e of json.plugins as Record<string, unknown>[]) {
    if (typeof e?.id === 'string' && typeof e.name === 'string' && typeof e.version === 'string' && typeof e.url === 'string' && typeof e.sha256 === 'string' && /^[0-9a-fA-F]{64}$/.test(e.sha256) && allowedUrl(e.url)) {
      out.push({ id: e.id, name: e.name, version: e.version, description: typeof e.description === 'string' ? e.description : undefined, author: typeof e.author === 'string' ? e.author : undefined, url: e.url, sha256: e.sha256.toLowerCase(), permits: Array.isArray(e.permits) ? e.permits.filter((p): p is string => typeof p === 'string') : undefined })
    }
  }
  return out.slice(0, 200)
}

/** Downloads a catalogue entry, checks its checksum and installs it. */
export async function installFromCatalogue(root: string, entry: CatalogueEntry, fetcher: typeof fetch): Promise<PluginManifest> {
  if (!allowedUrl(entry.url)) throw new Error('The download address is not allowed.')
  const res = await fetcher(entry.url, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`The download failed (${res.status}).`)
  const data = new Uint8Array(await res.arrayBuffer())
  const sum = createHash('sha256').update(data).digest('hex')
  if (sum !== entry.sha256.toLowerCase()) throw new Error('The download does not match its checksum, so it was not installed.')
  const manifest = await installFromZip(root, data)
  if (manifest.id !== entry.id) {
    await uninstallPlugin(root, manifest.id)
    throw new Error('The downloaded plugin is not the one the catalogue listed.')
  }
  return manifest
}
