import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { batesLogCsv, numberFile, planNumbering } from './batesMulti'
import { pageContent } from './pageContent'
import { runBatch, runSteps, type BatchEnv, type BatchIO, type BatchStep } from './batch'

const env: BatchEnv = { ocr: async (b) => ({ bytes: b, words: 0, pagesDone: 0 }), encrypt: async (b) => b, findFont: async () => null }
const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('')

async function make(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([300, 300])
  return doc.save()
}

describe('planNumbering', () => {
  it('carries the number from file to file', () => {
    const plan = planNumbering([{ name: 'a.pdf', pages: 3 }, { name: 'b.pdf', pages: 2 }, { name: 'c.pdf', pages: 1 }], { prefix: 'RFI-', suffix: '', start: 10, digits: 4 })
    expect(plan.map((p) => [p.first, p.last])).toEqual([
      ['RFI-0010', 'RFI-0012'],
      ['RFI-0013', 'RFI-0014'],
      ['RFI-0015', 'RFI-0015']
    ])
    expect(plan[1]).toMatchObject({ firstPage: 4, lastPage: 5 })
  })
  it('leaves a file with no pages out of the numbering', () => {
    const plan = planNumbering([{ name: 'a.pdf', pages: 0 }, { name: 'b.pdf', pages: 1 }], { prefix: '', suffix: '', start: 1, digits: 3 })
    expect(plan[0].first).toBe('')
    expect(plan[1].first).toBe('001')
  })
})

describe('batesLogCsv', () => {
  it('quotes what needs it', () => {
    const csv = batesLogCsv([
      { source: 'a, b.pdf', output: 'a_b.pdf', pages: 2, first: 'X1', last: 'X2' },
      { source: 'c.pdf', output: '', pages: 0, first: '', last: '', error: 'bad "file"' }
    ])
    expect(csv.split('\r\n')[0]).toBe('File,Output,Pages,First number,Last number,Result')
    expect(csv).toContain('"a, b.pdf",a_b.pdf,2,X1,X2,Done')
    expect(csv).toContain('"Failed: bad ""file"""')
  })
})

describe('numberFile', () => {
  it('writes the running number on every page, and the total across all files for <<pages>>', async () => {
    const r = await numberFile(
      await make(2),
      'b.pdf',
      { slots: { br: '<<bates>> <<page>>/<<pages>>' }, fontSize: 9, font: 'Helvetica', color: '#000000', margin: 20 },
      { prefix: 'P', suffix: '', start: 1, digits: 3 },
      3,
      1,
      10
    )
    const doc = await PDFDocument.load(r.bytes)
    expect(pageContent(doc.getPage(0))).toContain(hex('P004 4/10'))
    expect(pageContent(doc.getPage(1))).toContain(hex('P005 5/10'))
  })
})

describe('Bates as a batch step', () => {
  const step: BatchStep = { kind: 'bates', slot: 'br', prefix: 'B', suffix: '', start: 1, digits: 3, fontSize: 9, color: '#000000', margin: 20, carry: true }
  it('runs on across the files of a batch and records the numbers', async () => {
    const store = new Map<string, Uint8Array>([
      ['a.pdf', await make(2)],
      ['b.pdf', await make(3)]
    ])
    const written: Record<string, Uint8Array> = {}
    const io: BatchIO = {
      expand: async () => ['a.pdf', 'b.pdf'],
      read: async (p) => ({ name: p, data: store.get(p)! }),
      write: async (s, _d, x, data) => ((written[s + x] = data), s + x)
    }
    const res = await runBatch({ steps: [step], inputs: ['x'], recursive: false, outDir: null, suffix: '_n' }, io, env)
    expect(res.map((r) => r.bates)).toEqual([
      { first: 'B001', last: 'B002', pages: 2 },
      { first: 'B003', last: 'B005', pages: 3 }
    ])
    expect(pageContent((await PDFDocument.load(written['b.pdf_n'])).getPage(2))).toContain(hex('B005'))
  })
  it('starts every file again when it is not carried on', async () => {
    const a = await runSteps(await make(2), 'a.pdf', [{ ...step, carry: false }], env, { offsets: {} })
    const b = await runSteps(await make(2), 'b.pdf', [{ ...step, carry: false }], env, { offsets: {} })
    expect(a.bates?.first).toBe('B001')
    expect(b.bates?.first).toBe('B001')
  })
  it('does not leave a gap for a file that fails', async () => {
    const files: Record<string, Uint8Array> = { 'a.pdf': new TextEncoder().encode('not a pdf'), 'b.pdf': await make(1) }
    const io: BatchIO = { expand: async () => ['a.pdf', 'b.pdf'], read: async (p) => ({ name: p, data: files[p] }), write: async (s) => s }
    const res = await runBatch({ steps: [step], inputs: ['x'], recursive: false, outDir: null, suffix: '' }, io, env)
    expect(res[0].ok).toBe(false)
    expect(res[1].bates?.first).toBe('B001')
  })
})
