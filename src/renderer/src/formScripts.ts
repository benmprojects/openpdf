/**
 * Running form scripts (field format, keystroke, validate and calculate actions, and button scripts). Each run gets a
 * fresh QuickJS runtime (MIT, compiled to WebAssembly) with a time limit and a memory cap, no file, network or app access:
 * the form's state goes in as JSON and what the script changed comes back as JSON.
 */
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-singlefile-mjs-release-sync'
import { wrapScript } from './acrobatJs'
import type { FieldType, FormField, FormValue } from './forms'

export type ScriptKind = 'Format' | 'Keystroke' | 'Validate' | 'Calculate' | 'MouseUp' | 'Open' | 'WillClose' | 'WillSave' | 'DidSave' | 'WillPrint' | 'DidPrint'

export interface FieldState {
  name: string
  type: FieldType
  value: FormValue
  readOnly: boolean
  /** The field is formatted as a number: scripts read its value as a number. */
  numeric: boolean
  /** The document's own JavaScript (carried on the states and run before the script; it is not passed to the sandbox as data). */
  docJs?: string
}

export interface RunResult {
  /** `event.value` after the script, as text. */
  value: string
  /** False when the script rejected the value (`event.rc = false`). */
  rc: boolean
  /** Fields the script set through `getField(...).value`. */
  changed: Map<string, FormValue>
  alerts: string[]
  log: string[]
  error?: string
}

/** Longest a script may run, and how much memory it may use. */
const TIME_LIMIT_MS = 250
const MEMORY_LIMIT = 32 * 1024 * 1024
const STACK_LIMIT = 512 * 1024

let quickjs: Promise<QuickJSWASMModule> | null = null
const engine = () => (quickjs ??= newQuickJSWASMModuleFromVariant(variant))

export async function runScript(
  kind: ScriptKind,
  code: string,
  target: string,
  fields: FieldState[],
  event: { value?: string; change?: string; willCommit?: boolean } = {},
  fileName = '',
  pageCount = 1
): Promise<RunResult> {
  const docJs = fields.find((f) => f.docJs)?.docJs
  const plain = fields.map((f) => ({ name: f.name, type: f.type, value: f.value, readOnly: f.readOnly, numeric: f.numeric }))
  const input = { fields: plain, target, pages: pageCount, fileName, event: { name: kind, value: event.value ?? '', change: event.change ?? '', willCommit: event.willCommit ?? true } }
  const source = `var __inputJson = ${JSON.stringify(JSON.stringify(input))};\n${wrapScript(docJs ? `${docJs}
${code}` : code)}`
  const qjs = await engine()
  try {
    const out = qjs.evalCode(source, { shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + TIME_LIMIT_MS), memoryLimitBytes: MEMORY_LIMIT, maxStackSizeBytes: STACK_LIMIT })
    const r = JSON.parse(String(out)) as { value: unknown; rc: boolean; changed: Record<string, FormValue>; alerts: string[]; log: string[]; error: string }
    return { value: r.value == null ? '' : String(r.value), rc: r.rc, changed: new Map(Object.entries(r.changed).map(([k, v]): [string, FormValue] => [k, typeof v === 'number' ? String(v) : v])), alerts: r.alerts, log: r.log, error: r.error || undefined }
  } catch (e) {
    // QuickJS throws the script's error as a plain object (name, message, stack).
    const msg = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
    return { value: event.value ?? '', rc: true, changed: new Map(), alerts: [], log: [], error: /interrupted/i.test(msg) ? 'The script took too long and was stopped.' : msg }
  }
}

/** Whether a field's format script makes its value a number. */
export const isNumericField = (f: FormField) => /AFNumber_Format|AFPercent_Format/.test(f.scripts?.format ?? '')

export function fieldStates(fields: FormField[], values: ReadonlyMap<string, FormValue>): FieldState[] {
  return fields.map((f) => ({ name: f.name, type: f.type, value: values.get(f.name) ?? f.value, readOnly: f.readOnly, numeric: isNumericField(f), docJs: f.docJs }))
}

/** The text a field shows when it is not being edited: its value through the format script, if it has one. */
export async function displayValue(f: FormField, raw: string, states: FieldState[]): Promise<string> {
  const code = f.scripts?.format
  if (!code || raw === '') return raw
  const r = await runScript('Format', code, f.name, states, { value: raw })
  return r.error ? raw : r.value
}

export interface CommitResult {
  ok: boolean
  /** The value to keep (a keystroke script may change it). */
  value: string
  alerts: string[]
  /** What the scripts printed with console.println. */
  log: string[]
  error?: string
}

/** A value being committed to a field: the keystroke script, then the validate script. */
export async function commitValue(f: FormField, raw: string, states: FieldState[]): Promise<CommitResult> {
  let value = raw
  const alerts: string[] = []
  const log: string[] = []
  for (const [kind, code] of [['Keystroke', f.scripts?.keystroke], ['Validate', f.scripts?.validate]] as const) {
    if (!code) continue
    const r = await runScript(kind, code, f.name, states, { value, change: kind === 'Keystroke' ? raw : '', willCommit: true })
    alerts.push(...r.alerts)
    log.push(...r.log)
    if (r.error) return { ok: true, value, alerts, log, error: r.error }
    if (!r.rc) return { ok: false, value, alerts, log }
    value = r.value
  }
  return { ok: true, value, alerts, log }
}

/**
 * Runs every calculate script in order and returns the values that changed. Several passes, because one calculation can
 * feed another; it stops when nothing changes (at most five times).
 */
export async function recalculate(fields: FormField[], values: ReadonlyMap<string, FormValue>): Promise<{ changed: Map<string, FormValue>; alerts: string[]; log: string[]; error?: string }> {
  const calc = fields.filter((f) => f.scripts?.calculate).sort((a, b) => (a.calcOrder ?? 1e6) - (b.calcOrder ?? 1e6))
  const current = new Map(values)
  const changed = new Map<string, FormValue>()
  const alerts: string[] = []
  const log: string[] = []
  let error: string | undefined
  for (let pass = 0; pass < 5 && calc.length; pass++) {
    let moved = false
    for (const f of calc) {
      const states = fieldStates(fields, current)
      const now = current.get(f.name) ?? f.value
      const r = await runScript('Calculate', f.scripts!.calculate!, f.name, states, { value: typeof now === 'string' ? now : '' })
      alerts.push(...r.alerts)
      log.push(...r.log)
      if (r.error) {
        error = r.error
        continue
      }
      if (r.rc) {
        const next = r.value
        if (next !== (typeof now === 'string' ? now : '')) {
          current.set(f.name, next)
          changed.set(f.name, next)
          moved = true
        }
      }
      for (const [name, v] of r.changed) {
        if (JSON.stringify(current.get(name) ?? fields.find((x) => x.name === name)?.value) !== JSON.stringify(v)) {
          current.set(name, v)
          changed.set(name, v)
          moved = true
        }
      }
    }
    if (!moved) break
  }
  return { changed, alerts: [...new Set(alerts)], log, error }
}
