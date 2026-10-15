/**
 * Translations the user has added: JSON files in the `locales` folder of the user's data folder, named by language
 * code (fr.json, de-AT.json). They are checked (sizes, types) before the program uses them; a bad file is skipped.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface UserCatalogue {
  name: string
  messages: Record<string, string>
}

const CODE = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.json$/
const MAX_MESSAGES = 6000
const MAX_TEXT = 600

/** Reads and checks one catalogue; null when it is not one. */
export function checkCatalogue(raw: unknown): UserCatalogue | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as { name?: unknown; messages?: unknown }
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 80 || !c.messages || typeof c.messages !== 'object') return null
  const messages: Record<string, string> = {}
  let n = 0
  for (const [k, v] of Object.entries(c.messages as Record<string, unknown>)) {
    if (typeof v !== 'string' || !v || k.length > MAX_TEXT || v.length > MAX_TEXT) continue
    messages[k] = v
    if (++n >= MAX_MESSAGES) break
  }
  return { name: c.name.trim(), messages }
}

export async function userCatalogues(folder: string): Promise<Record<string, UserCatalogue>> {
  const out: Record<string, UserCatalogue> = {}
  let files: string[]
  try {
    files = await readdir(folder)
  } catch {
    return out
  }
  for (const f of files.slice(0, 50)) {
    const m = CODE.exec(f)
    if (!m) continue
    try {
      const c = checkCatalogue(JSON.parse(await readFile(join(folder, f), 'utf8')))
      if (c) out[m[1]] = c
    } catch {
      // not valid JSON: skipped
    }
  }
  return out
}
