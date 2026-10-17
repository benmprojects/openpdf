import { PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { joinDocScripts, readDocScripts, writeDocScripts } from './docScripts'
import { commitValue, fieldStates, runScript } from './formScripts'
import type { FormField } from './forms'

async function blank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  return doc.save()
}

describe('document JavaScript', () => {
  it('writes scripts and reads them back in name order', async () => {
    const out = await writeDocScripts(await blank(), [
      { name: 'zeta', code: 'function z() { return 1; }' },
      { name: 'alpha', code: 'function double(n) { return n * 2; } // é' }
    ])
    expect(await readDocScripts(out)).toEqual([
      { name: 'alpha', code: 'function double(n) { return n * 2; } // é' },
      { name: 'zeta', code: 'function z() { return 1; }' }
    ])
  })

  it('replaces the scripts and removes them all', async () => {
    const one = await writeDocScripts(await blank(), [{ name: 'a', code: 'var x = 1;' }])
    const two = await writeDocScripts(one, [{ name: 'b', code: 'var y = 2;' }])
    expect((await readDocScripts(two)).map((s) => s.name)).toEqual(['b'])
    const none = await writeDocScripts(two, [])
    expect(await readDocScripts(none)).toEqual([])
    const doc = await PDFDocument.load(none)
    expect(doc.catalog.has(PDFName.of('Names'))).toBe(false)
  })

  it('refuses empty and repeated names', async () => {
    await expect(writeDocScripts(await blank(), [{ name: ' ', code: '' }])).rejects.toThrow(/name/)
    await expect(writeDocScripts(await blank(), [{ name: 'a', code: '' }, { name: 'a', code: '' }])).rejects.toThrow(/same name/)
  })

  it('joins scripts into one program', () => {
    expect(joinDocScripts([{ name: 'a', code: 'var a=1;' }, { name: 'b', code: 'var b=2;' }])).toBe('var a=1;\nvar b=2;')
  })
})

describe('document scripts in the sandbox', () => {
  const field = (docJs?: string): FormField => ({
    name: 'qty',
    type: 'text',
    value: '',
    initial: '',
    readOnly: false,
    required: false,
    align: 0,
    fontSize: 0,
    color: '#000',
    tooltip: '',
    scripts: { validate: 'if (!isPositive(Number(event.value))) { event.rc = false; app.alert("Enter a positive number."); }' },
    widgets: [],
    docJs
  })

  it('lets a field script call a function the document defines', async () => {
    const f = field('function isPositive(n) { return n > 0; }')
    const ok = await commitValue(f, '5', fieldStates([f], new Map()))
    expect(ok.ok).toBe(true)
    const bad = await commitValue(f, '-3', fieldStates([f], new Map()))
    expect(bad.ok).toBe(false)
    expect(bad.alerts).toEqual(['Enter a positive number.'])
  })

  it('reports the error when the function is missing', async () => {
    const f = field()
    const r = await commitValue(f, '5', fieldStates([f], new Map()))
    expect(r.error).toMatch(/isPositive/)
  })

  it('runs a script on its own with console output', async () => {
    const r = await runScript('MouseUp', 'console.println("hello " + double(21));', 'x', [], {}, 'f.pdf')
    expect(r.error).toMatch(/double/)
    const r2 = await runScript('MouseUp', 'function double(n) { return n * 2; }\nconsole.println("hello " + double(21));', 'x', [], {}, 'f.pdf')
    expect(r2.log).toEqual(['hello 42'])
  })
})
