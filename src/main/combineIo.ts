/**
 * File access for the Combine files dialog: the files the person picked (or found in a folder), listed with their
 * size and date, then read one at a time. Only paths this module has listed can be read back.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

export interface CombineFile {
  path: string
  name: string
  size: number
  /** Last modified, milliseconds since 1970. */
  mtime: number
}

export const COMBINE_PDF = ['pdf']
export const COMBINE_PICTURES = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'gif', 'bmp', 'webp']
export const COMBINE_OFFICE = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']
export const COMBINE_EXT = [...COMBINE_PDF, ...COMBINE_PICTURES, ...COMBINE_OFFICE]

const MAX_FILES = 500
const MAX_BYTES = 1024 * 1024 * 1024
const known = new Set<string>()
const supported = (p: string) => COMBINE_EXT.includes(extname(p).slice(1).toLowerCase())

/** Describes the supported files among `paths` (folders are searched one level deep, in name order). */
export async function describeCombineFiles(paths: string[]): Promise<CombineFile[]> {
  const out: CombineFile[] = []
  const add = async (p: string) => {
    if (out.length >= MAX_FILES || !supported(p)) return
    const s = await stat(p).catch(() => null)
    if (!s || !s.isFile()) return
    known.add(p)
    out.push({ path: p, name: basename(p), size: s.size, mtime: s.mtimeMs })
  }
  for (const raw of paths) {
    const p = resolve(raw)
    const s = await stat(p).catch(() => null)
    if (!s) continue
    if (s.isDirectory()) {
      const entries = (await readdir(p, { withFileTypes: true }).catch(() => [])).filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
      for (const e of entries) await add(join(p, e.name))
    } else await add(p)
  }
  return out
}

/** The bytes of a file that describeCombineFiles listed. */
export async function readCombineFile(path: string): Promise<Uint8Array> {
  const p = resolve(path)
  if (!known.has(p)) throw new Error('That file was not chosen in the Combine files dialog.')
  const s = await stat(p)
  if (s.size > MAX_BYTES) throw new Error(`${basename(p)} is over 1 GB.`)
  return new Uint8Array(await readFile(p))
}

/** Allows an Office conversion only for a listed file. */
export function checkCombinePath(path: string): string {
  const p = resolve(path)
  if (!known.has(p)) throw new Error('That file was not chosen in the Combine files dialog.')
  return p
}
