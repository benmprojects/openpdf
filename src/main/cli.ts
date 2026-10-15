/**
 * Command line: `OpenPDF --batch <action> --out <folder> [options] <files or folders...>` runs a saved or shared
 * action over PDFs without showing a window, then exits (0 when every file worked, 1 when some failed, 2 for a
 * usage error). The work is done by the same code the Batch dialog uses, in a hidden window.
 */
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { BatchAction } from '../renderer/src/batch'

export type CliParse =
  | { kind: 'batch'; action: string; out: string | null; suffix: string; recursive: boolean; report: string | null; inputs: string[] }
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'error'; message: string }

export const HELP = `OpenPDF command line

  OpenPDF --batch <action> [--out <folder>] [--suffix <text>] [--recursive] [--report <file>] <files or folders...>
  OpenPDF --list-actions
  OpenPDF --help

<action> is the name of an action saved in the Batch dialog, or the path of an action file (.json).
Results go in --out, or beside each original when it is left out. Originals are never changed and no file is
overwritten (a number is added to the name). --suffix is added to each result's name (default _processed).
--report writes a JSON summary. Exit code: 0 all files processed, 1 some failed, 2 bad arguments.
Windows programs started from a window do not print to it: use --report, or start with: start /wait OpenPDF ...
`

/** Reads the arguments that follow the program name. Returns null when the run is not a command-line one. */
export function parseCli(args: string[]): CliParse | null {
  const has = (f: string) => args.includes(f)
  if (has('--help') || has('-h')) return { kind: 'help' }
  if (has('--list-actions')) return { kind: 'list' }
  const at = args.indexOf('--batch')
  if (at < 0) return null
  const action = args[at + 1]
  if (!action || action.startsWith('--')) return { kind: 'error', message: '--batch needs an action name or file.' }
  let out: string | null = null
  let suffix = '_processed'
  let recursive = false
  let report: string | null = null
  const inputs: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (i === at || i === at + 1) continue
    const a = args[i]
    const value = (): string | undefined => {
      const v = args[i + 1]
      if (v === undefined || v.startsWith('--')) return undefined
      i++
      return v
    }
    if (a === '--out') {
      const v = value()
      if (!v) return { kind: 'error', message: '--out needs a folder.' }
      out = v
    } else if (a === '--suffix') {
      const v = args[i + 1]
      if (v === undefined) return { kind: 'error', message: '--suffix needs some text.' }
      suffix = v
      i++
    } else if (a === '--report') {
      const v = value()
      if (!v) return { kind: 'error', message: '--report needs a file name.' }
      report = v
    } else if (a === '--recursive' || a === '-r') recursive = true
    else if (a.startsWith('--')) return { kind: 'error', message: `Unknown option ${a}.` }
    else if (!a.startsWith('-')) inputs.push(a)
  }
  if (!inputs.length) return { kind: 'error', message: 'Give at least one file or folder to process.' }
  return { kind: 'batch', action, out, suffix, recursive, report, inputs }
}

/** An action file's steps, or the saved action with that name. */
export async function loadAction(ref: string, saved: BatchAction[], cwd = process.cwd()): Promise<BatchAction> {
  if (extname(ref).toLowerCase() === '.json') {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(resolve(cwd, ref), 'utf8'))
    } catch {
      throw new Error(`The action file ${ref} could not be read.`)
    }
    const a = raw as BatchAction
    if (!a || !Array.isArray(a.steps) || !a.steps.length) throw new Error(`${ref} is not a batch action.`)
    return { name: a.name ?? ref, steps: a.steps }
  }
  const found = saved.find((a) => a.name.toLowerCase() === ref.toLowerCase())
  if (!found) throw new Error(`There is no saved action called "${ref}". Use --list-actions to see them.`)
  return found
}
