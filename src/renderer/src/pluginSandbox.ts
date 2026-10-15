/**
 * Runs a plugin's script. Like the form scripts, it gets a fresh QuickJS runtime (WebAssembly) with a time limit and a
 * memory cap and nothing else: no files, network, clock or program access. It is given a description of the document
 * and its parameters, defines `run(doc, params)`, and returns what it wants done as data (checked afterwards against
 * the plugin's manifest by `normaliseResult`).
 */
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-singlefile-mjs-release-sync'

export interface PluginDoc {
  fileName: string
  pageCount: number
  info: { title: string; author: string; subject: string; keywords: string }
  pages: { index: number; width: number; height: number; text: string }[]
}

const TIME_LIMIT_MS = 2000
const MEMORY_LIMIT = 64 * 1024 * 1024
const STACK_LIMIT = 512 * 1024
/** Most text handed to a script, over all pages. */
const MAX_TEXT = 500_000

let engine: Promise<QuickJSWASMModule> | null = null

/** The document as a script sees it: page text is cut once the total passes the limit. */
export function limitDoc(doc: PluginDoc): PluginDoc {
  let left = MAX_TEXT
  return {
    ...doc,
    pages: doc.pages.map((p) => {
      const text = p.text.slice(0, Math.max(0, left))
      left -= text.length
      return { ...p, text }
    })
  }
}

/** Runs the script and returns whatever its `run` returned (parsed from JSON), or `{ error }`. */
export async function runPluginScript(code: string, doc: PluginDoc, params: Record<string, string>): Promise<unknown> {
  const source =
    `var __doc = JSON.parse(${JSON.stringify(JSON.stringify(limitDoc(doc)))});\n` +
    `var __params = JSON.parse(${JSON.stringify(JSON.stringify(params))});\n` +
    `var console = { log: function () {}, warn: function () {}, error: function () {} };\n` +
    `${code}\n;\n` +
    `(function () {\n` +
    `  try {\n` +
    `    if (typeof run !== 'function') return JSON.stringify({ error: 'The plugin has no run function.' });\n` +
    `    var r = run(__doc, __params);\n` +
    `    return JSON.stringify(r === undefined ? {} : r);\n` +
    `  } catch (e) {\n` +
    `    return JSON.stringify({ error: 'The plugin failed: ' + (e && e.message ? e.message : String(e)) });\n` +
    `  }\n` +
    `})()`
  engine ??= newQuickJSWASMModuleFromVariant(variant)
  const qjs = await engine
  try {
    const out = qjs.evalCode(source, { shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + TIME_LIMIT_MS), memoryLimitBytes: MEMORY_LIMIT, maxStackSizeBytes: STACK_LIMIT })
    return JSON.parse(String(out))
  } catch (e) {
    const msg = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
    return { error: /interrupted/i.test(msg) ? 'The plugin took too long and was stopped.' : `The plugin could not run: ${msg}` }
  }
}
