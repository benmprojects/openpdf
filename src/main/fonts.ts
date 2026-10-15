/** Installed fonts (Windows): found through the registry's font lists, read from disk only when one is asked for. */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { matchFont, parseFontRegistry, type InstalledFont } from '../shared/fontMatch'

const KEYS: { key: string; dir: () => string }[] = [
  { key: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', dir: () => join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts') },
  { key: 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', dir: () => join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Fonts') }
]

interface Entry extends InstalledFont {
  path: string
}

let index: Promise<Entry[]> | null = null

function query(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

function loadIndex(): Promise<Entry[]> {
  index ??= Promise.all(KEYS.map(async (k) => parseFontRegistry(await query(k.key)).map((f): Entry => ({ ...f, path: isAbsolute(f.file) ? f.file : join(k.dir(), f.file) })))).then((lists) => lists.flat())
  return index
}

/** The font file for a PDF font name with the wanted weight and slant, or null when it is not installed (or not Windows). */
export async function findFont(name: string, bold: boolean, italic: boolean): Promise<{ data: Uint8Array; family: string } | null> {
  if (process.platform !== 'win32') return null
  const fonts = await loadIndex()
  const hit = matchFont(fonts, name, bold, italic) as Entry | undefined
  if (!hit) return null
  try {
    const data = await readFile(hit.path)
    return { data: new Uint8Array(data), family: hit.key.family }
  } catch {
    return null
  }
}
