/**
 * Finds cloud folders synced to this computer: OneDrive and SharePoint libraries (from the OneDrive client's registry
 * entries and its environment variables), Dropbox (from its info file) and Google Drive for desktop (a "My Drive"
 * folder on a drive letter or in the user's folder). Only folders that exist are returned.
 */
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSyncEngines, uniquePlaces, type Place } from '../shared/places'

const exists = (p: string) => stat(p).then((s) => s.isDirectory(), () => false)

function regQuery(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

export async function listPlaces(): Promise<Place[]> {
  const found: Place[] = []

  // OneDrive: the user's own folders, then each synced SharePoint library.
  for (const [name, label] of [['OneDrive', 'OneDrive'], ['OneDriveCommercial', 'OneDrive (work)'], ['OneDriveConsumer', 'OneDrive (personal)']] as const) {
    const p = process.env[name]
    if (p) found.push({ kind: 'onedrive', label, path: p })
  }
  found.push(...parseSyncEngines(await regQuery('HKCU\\Software\\SyncEngines\\Providers\\OneDrive')))

  // Dropbox.
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (!base) continue
    try {
      const info = JSON.parse(await readFile(join(base, 'Dropbox', 'info.json'), 'utf8')) as Record<string, { path?: string }>
      for (const [k, v] of Object.entries(info)) if (v?.path) found.push({ kind: 'dropbox', label: k === 'business' ? 'Dropbox (work)' : 'Dropbox', path: v.path })
    } catch {
      // not installed
    }
  }

  // Google Drive for desktop mounts a drive letter with a "My Drive" folder; older clients used a folder in the profile.
  const home = process.env.USERPROFILE
  if (home) for (const n of ['Google Drive', 'My Drive']) if (await exists(join(home, n))) found.push({ kind: 'googledrive', label: 'Google Drive', path: join(home, n) })
  for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    const p = `${letter}:\\My Drive`
    if (await exists(p)) found.push({ kind: 'googledrive', label: 'Google Drive', path: p })
  }

  const real: Place[] = []
  for (const p of uniquePlaces(found)) if (await exists(p.path)) real.push(p)
  return real
}
