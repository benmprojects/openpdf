import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appFor, validExePath, type LaunchApp } from '../shared/prefs'

/** A file name safe to create on Windows: no folders, no reserved characters, not empty. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120)
  return clean || 'file'
}

export type LaunchResult = { ok: true; app: string; file: string } | { ok: false; error: string }

/**
 * Opens a file with the program the user chose for its extension. The bytes are written to a fresh temporary folder
 * first (attachments live inside the PDF). Only programs listed in Settings can run, and the file is the only argument.
 * `run` is replaced in tests.
 */
export async function launchWith(
  apps: LaunchApp[],
  fileName: string,
  data: Uint8Array,
  run: (exe: string, file: string) => void | Promise<void> = (exe, file) => {
    execFile(exe, [file], { windowsHide: false }, () => undefined).unref()
  }
): Promise<LaunchResult> {
  const name = safeFileName(fileName)
  const app = appFor(apps, name)
  if (!app) return { ok: false, error: 'No program is set for this kind of file. Add one under Settings > Launch applications.' }
  if (!validExePath(app.path) || !existsSync(app.path)) return { ok: false, error: `${app.name} was not found at the saved location.` }
  if (data.length > 500 * 1024 * 1024) return { ok: false, error: 'That file is too large to hand to another program.' }
  const dir = await mkdtemp(join(tmpdir(), 'openpdf-launch-'))
  const file = join(dir, name)
  await writeFile(file, data)
  await run(app.path, file)
  return { ok: true, app: app.name, file }
}
