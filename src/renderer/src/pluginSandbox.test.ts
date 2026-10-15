import { describe, expect, it } from 'vitest'
import { limitDoc, runPluginScript, type PluginDoc } from './pluginSandbox'

const doc: PluginDoc = {
  fileName: 'tender.pdf',
  pageCount: 2,
  info: { title: 'Tender', author: '', subject: '', keywords: '' },
  pages: [
    { index: 0, width: 595, height: 842, text: 'Job 4471 Brisbane' },
    { index: 1, width: 595, height: 842, text: 'Schedule' }
  ]
}

describe('runPluginScript', () => {
  it('gives the script the document and its parameters and returns what it returns', async () => {
    const r = (await runPluginScript(
      `function run(doc, params) {
         var m = /Job (\\d+)/.exec(doc.pages[0].text);
         return { message: 'found ' + (m ? m[1] : 'none'), steps: [{ kind: 'watermark', text: params.prefix + (m ? m[1] : '') }], pages: doc.pageCount, file: doc.fileName };
       }`,
      doc,
      { prefix: 'JOB-' }
    )) as { message: string; steps: { text: string }[]; pages: number; file: string }
    expect(r.message).toBe('found 4471')
    expect(r.steps[0].text).toBe('JOB-4471')
    expect(r.pages).toBe(2)
    expect(r.file).toBe('tender.pdf')
  })

  it('reports a script with no run function, an exception, and a syntax error', async () => {
    expect(await runPluginScript('var x = 1', doc, {})).toEqual({ error: 'The plugin has no run function.' })
    expect(((await runPluginScript('function run() { throw new Error("no job number") }', doc, {})) as { error: string }).error).toBe('The plugin failed: no job number')
    expect(((await runPluginScript('function run( {', doc, {})) as { error: string }).error).toMatch(/could not run/)
  })

  it('stops a script that never ends, and gives it no way to reach files or the network', async () => {
    const r = (await runPluginScript('function run() { while (true) {} }', doc, {})) as { error: string }
    expect(r.error).toMatch(/took too long/)
    const probe = (await runPluginScript('function run() { return { fetch: typeof fetch, require: typeof require, process: typeof process, window: typeof window, XMLHttpRequest: typeof XMLHttpRequest } }', doc, {})) as Record<string, string>
    expect(Object.values(probe).every((v) => v === 'undefined')).toBe(true)
  })

  it('treats a script that returns nothing as having nothing to do', async () => {
    expect(await runPluginScript('function run() {}', doc, {})).toEqual({})
  })
})

describe('limitDoc', () => {
  it('cuts page text once the total passes the limit', () => {
    const big: PluginDoc = { ...doc, pages: [{ index: 0, width: 1, height: 1, text: 'a'.repeat(400_000) }, { index: 1, width: 1, height: 1, text: 'b'.repeat(400_000) }, { index: 2, width: 1, height: 1, text: 'c' }] }
    const out = limitDoc(big)
    expect(out.pages.map((p) => p.text.length)).toEqual([400_000, 100_000, 0])
  })
})
