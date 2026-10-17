import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

/** A user's image stamp, kept in userData/stamps. */
export interface ImageStamp {
  id: string
  name: string
  /** data: URL of the PNG or JPEG. */
  dataUrl: string
  /** Pixel size, for the aspect ratio. */
  width: number
  height: number
  /** Palette category; "My stamps" when it was not set. */
  category: string
}

interface Entry {
  id: string
  name: string
  file: string
  width: number
  height: number
  category?: string
}

const MAX_BYTES = 8 * 1024 * 1024
const dir = () => join(app.getPath('userData'), 'stamps')
const indexFile = () => join(dir(), 'index.json')

async function readIndex(): Promise<Entry[]> {
  try {
    const list = JSON.parse(await readFile(indexFile(), 'utf8'))
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string' && /^[\w-]+\.(png|jpg)$/.test(e.file)) : []
  } catch {
    return []
  }
}

async function writeIndex(list: Entry[]) {
  await mkdir(dir(), { recursive: true })
  await writeFile(`${indexFile()}.tmp`, JSON.stringify(list, null, 2))
  await rename(`${indexFile()}.tmp`, indexFile())
}

/** Image type and pixel size from the file header; null if it is not a PNG or baseline/progressive JPEG. */
export function imageInfo(b: Uint8Array): { type: 'png' | 'jpg'; width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { type: 'png', width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the JPEG segments to a start-of-frame marker, which holds the size.
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      const len = v.getUint16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpg', height: v.getUint16(i + 5), width: v.getUint16(i + 7) }
      }
      i += 2 + len
    }
  }
  return null
}

export async function listStamps(): Promise<ImageStamp[]> {
  const out: ImageStamp[] = []
  for (const e of await readIndex()) {
    try {
      const data = await readFile(join(dir(), e.file))
      out.push({ id: e.id, name: e.name, category: e.category || 'My stamps', width: e.width, height: e.height, dataUrl: `data:image/${e.file.endsWith('.png') ? 'png' : 'jpeg'};base64,${data.toString('base64')}` })
    } catch {
      // A missing file is skipped.
    }
  }
  return out
}

/** Copies images into the library. Returns the names that were refused (not PNG/JPEG, or too large). */
export async function addStamps(paths: string[], category = 'My stamps'): Promise<{ added: number; refused: string[] }> {
  const list = await readIndex()
  const refused: string[] = []
  let added = 0
  await mkdir(dir(), { recursive: true })
  for (const p of paths) {
    try {
      const data = new Uint8Array(await readFile(p))
      const info = data.length <= MAX_BYTES ? imageInfo(data) : null
      if (!info) {
        refused.push(basename(p))
        continue
      }
      const id = randomUUID()
      const file = `${id}.${info.type}`
      await writeFile(join(dir(), file), data)
      list.push({ id, name: basename(p, extname(p)), file, width: info.width, height: info.height, category })
      added++
    } catch {
      refused.push(basename(p))
    }
  }
  await writeIndex(list)
  return { added, refused }
}

export async function removeStamp(id: string): Promise<void> {
  const list = await readIndex()
  const gone = list.find((e) => e.id === id)
  if (!gone) return
  await writeIndex(list.filter((e) => e.id !== id))
  await rm(join(dir(), gone.file), { force: true })
}

/** Adds pictures that are already in memory (a clipboard image, a snapshot, a rendered page, an imported collection). */
export async function addStampData(items: { name: string; category: string; data: Uint8Array }[]): Promise<{ added: ImageStamp[]; refused: string[] }> {
  const list = await readIndex()
  const refused: string[] = []
  const added: ImageStamp[] = []
  await mkdir(dir(), { recursive: true })
  for (const it of items) {
    const info = it.data.length <= MAX_BYTES ? imageInfo(it.data) : null
    if (!info) {
      refused.push(it.name)
      continue
    }
    const id = randomUUID()
    const file = `${id}.${info.type}`
    await writeFile(join(dir(), file), it.data)
    const category = it.category.trim().slice(0, 60) || 'My stamps'
    const name = it.name.trim().slice(0, 80) || 'Stamp'
    list.push({ id, name, file, width: info.width, height: info.height, category })
    added.push({ id, name, category, width: info.width, height: info.height, dataUrl: `data:image/${info.type === 'png' ? 'png' : 'jpeg'};base64,${Buffer.from(it.data).toString('base64')}` })
  }
  await writeIndex(list)
  return { added, refused }
}

/** Renames an image stamp or moves it to another category. */
export async function updateStamp(id: string, change: { name?: string; category?: string }): Promise<void> {
  const list = await readIndex()
  const e = list.find((x) => x.id === id)
  if (!e) return
  if (change.name?.trim()) e.name = change.name.trim().slice(0, 80)
  if (change.category?.trim()) e.category = change.category.trim().slice(0, 60)
  await writeIndex(list)
}

const metaFile = () => join(dir(), 'text-stamps.json')

/** The saved text stamps, recently used list and numbering counters, as JSON text; null if none yet. */
export async function readStampMeta(): Promise<string | null> {
  try {
    return await readFile(metaFile(), 'utf8')
  } catch {
    return null
  }
}

export async function writeStampMeta(json: string): Promise<void> {
  if (typeof json !== 'string' || json.length > 5 * 1024 * 1024) throw new Error('Stamp settings are too large.')
  await mkdir(dir(), { recursive: true })
  await writeFile(`${metaFile()}.tmp`, json)
  await rename(`${metaFile()}.tmp`, metaFile())
}
