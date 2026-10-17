/**
 * Renaming a document and moving it to the Recycle Bin. Never overwrites, never deletes for good, and only touches an
 * existing .pdf file. Kept free of Electron so it can be tested; the bin is reached through the `trash` function given.
 */
import { rename, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { cleanFileName } from '../shared/fileNames'

async function checkPdf(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !path || !/\.pdf$/i.test(path)) throw new Error('Only .pdf documents can be renamed or removed here.')
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new Error('That file is not there any more.')
  return path
}

/** Renames the file in its own folder to `newName`. Fails if another file already has that name. */
export async function renameDocument(path: string, newName: string): Promise<{ name: string; path: string }> {
  await checkPdf(path)
  const clean = cleanFileName(newName)
  if (clean.error) throw new Error(clean.error)
  const target = join(dirname(path), clean.name)
  if (target === path) return { name: basename(path), path }
  // A name that differs only in case is the same file on Windows: allowed, it is how a name's case is changed.
  const existing = await stat(target).catch(() => null)
  if (existing && target.toLowerCase() !== path.toLowerCase()) throw new Error(`There is already a file called ${clean.name} in that folder.`)
  await rename(path, target)
  return { name: clean.name, path: target }
}

/** Moves the file to the Recycle Bin (never a permanent delete). `trash` is Electron's shell.trashItem. */
export async function trashDocument(path: string, trash: (path: string) => Promise<void>): Promise<void> {
  await checkPdf(path)
  await trash(path)
}
