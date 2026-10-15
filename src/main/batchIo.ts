/**
 * File access for batch processing: finding the PDFs in a list of files and folders, reading one, writing a result
 * without ever overwriting an existing file, and the saved "actions" (named step lists).
 */
import { app } from 'electron'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { BatchAction } from '../renderer/src/batch'

const MAX_FILES = 5000
const MAX_BYTES = 1024 * 1024 * 1024

/** PDF files among the given paths, folders expanded (and their subfolders when asked), in a stable order. */
export async function expandPdfs(paths: string[], recursive: boolean): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (out.length >= MAX_FILES) return
      const p = join(dir, e.name)
      if (e.isFile() && extname(e.name).toLowerCase() === '.pdf') out.push(p)
      else if (e.isDirectory() && recursive && depth < 12) await walk(p, depth + 1)
    }
  }
  for (const raw of paths) {
    const p = resolve(raw)
    const s = await stat(p).catch(() => null)
    if (!s) continue
    if (s.isDirectory()) await walk(p, 0)
    else if (extname(p).toLowerCase() === '.pdf') out.push(p)
  }
  return [...new Set(out)].slice(0, MAX_FILES)
}

export async function readPdf(path: string): Promise<{ name: string; data: Uint8Array }> {
  if (extname(path).toLowerCase() !== '.pdf') throw new Error('Only PDF files can be processed.')
  const s = await stat(path)
  if (s.size > MAX_BYTES) throw new Error('That file is over 1 GB.')
  return { name: basename(path), data: new Uint8Array(await readFile(path)) }
}

/**
 * Writes a result as `<name><suffix>.pdf` in `outDir` (made if needed), or beside its source when there is none. A name
 * already taken gets " (2)" and so on: nothing is ever overwritten. Returns the path written.
 */
export async function writeResult(source: string, outDir: string | null, suffix: string, data: Uint8Array): Promise<string> {
  const dir = outDir ? resolve(outDir) : dirname(source)
  await mkdir(dir, { recursive: true })
  // eslint-disable-next-line no-control-regex
  const safeSuffix = suffix.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  const stem = basename(source, extname(source)) + safeSuffix
  let target = join(dir, `${stem}.pdf`)
  for (let n = 2; await stat(target).then(() => true, () => false); n++) target = join(dir, `${stem} (${n}).pdf`)
  await writeFile(`${target}.openpdf-tmp`, data)
  await rename(`${target}.openpdf-tmp`, target)
  return target
}

// ---- Saved actions ----------------------------------------------------------------------------------

const actionsFile = () => join(app.getPath('userData'), 'batch-actions.json')

const valid = (a: unknown): a is BatchAction => !!a && typeof a === 'object' && typeof (a as BatchAction).name === 'string' && Array.isArray((a as BatchAction).steps)

export async function listActions(): Promise<BatchAction[]> {
  try {
    const raw = JSON.parse(await readFile(actionsFile(), 'utf8'))
    return Array.isArray(raw) ? raw.filter(valid) : []
  } catch {
    return []
  }
}

async function writeActions(list: BatchAction[]): Promise<void> {
  const file = actionsFile()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, JSON.stringify(list, null, 2))
  await rename(`${file}.tmp`, file)
}

export async function saveAction(a: BatchAction): Promise<BatchAction[]> {
  if (!valid(a) || !a.name.trim()) throw new Error('An action needs a name and steps.')
  const list = (await listActions()).filter((x) => x.name !== a.name)
  list.push({ name: a.name.trim(), steps: a.steps })
  list.sort((x, y) => x.name.localeCompare(y.name))
  await writeActions(list)
  return list
}

export async function deleteAction(name: string): Promise<BatchAction[]> {
  const list = (await listActions()).filter((x) => x.name !== name)
  await writeActions(list)
  return list
}
