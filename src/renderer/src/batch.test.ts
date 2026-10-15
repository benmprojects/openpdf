import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { checkSteps, runBatch, runSteps, type BatchEnv, type BatchIO, type BatchStep } from './batch'
import { pageContent } from './pageContent'

const env: BatchEnv = {
  ocr: async (bytes) => ({ bytes, words: 0, pagesDone: 0 }),
  encrypt: async (bytes) => bytes,
  findFont: async () => null
}

async function make(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]).drawText(`Page ${i + 1}`, { x: 50, y: 200 })
  doc.setTitle('Original title')
  return doc.save()
}

describe('runSteps', () => {
  it('runs the steps in order over every page', async () => {
    const steps: BatchStep[] = [
      { kind: 'watermark', text: 'CONFIDENTIAL', fontSize: 40, color: '#ff0000', opacity: 0.3, angle: 45, behind: false },
      { kind: 'headerFooter', slots: { bc: 'Page <<page>> of <<pages>>', tl: '<<file>>' }, fontSize: 9, color: '#000000', margin: 24, startNumber: 1 },
      { kind: 'properties', title: 'Batch title', author: 'Records' },
      { kind: 'rotate', degrees: 90 }
    ]
    const out = await runSteps(await make(), 'contract.pdf', steps, env)
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getTitle()).toBe('Batch title')
    expect(doc.getAuthor()).toBe('Records')
    expect(doc.getPage(1).getRotation().angle).toBe(90)
    // The marks are on both pages.
    for (const i of [0, 1]) {
      const c = pageContent(doc.getPage(i))
      expect(c).toContain('434F4E464944454E5449414C') // CONFIDENTIAL
      expect(c).toContain('636F6E74726163742E706466') // contract.pdf
    }
  })

  it('removes hidden information and keeps the pages', async () => {
    const out = await runSteps(await make(1), 'a.pdf', [{ kind: 'sanitise', options: { metadata: true, attachments: true, javascript: true, comments: true, bookmarks: true, thumbnails: true } }], env)
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getTitle() ?? '').toBe('')
    expect(doc.getPageCount()).toBe(1)
  })

  it('hands OCR and encryption to the environment', async () => {
    const seen: string[] = []
    const e: BatchEnv = {
      ocr: async (b, s) => (seen.push(`ocr ${s.languages.join('+')}`), { bytes: b, words: 12, pagesDone: 1 }),
      encrypt: async (b, o) => (seen.push(`encrypt ${o.keyLength} ${o.userPassword}`), b),
      findFont: async () => null
    }
    const out = await runSteps(await make(1), 'a.pdf', [{ kind: 'ocr', languages: ['eng'], dpi: 300, all: false }, { kind: 'security', userPassword: 'pw', ownerPassword: '', keyLength: 256, permissions: { print: 'full', extract: true, accessibility: true, annotate: true, form: true, assemble: true, modifyOther: true } }], e)
    expect(seen).toEqual(['ocr eng', 'encrypt 256 pw'])
    expect(out.notes[0]).toBe('recognised 12 words on 1 page')
  })
})

describe('checkSteps', () => {
  it('asks for steps, text and a last-step password', () => {
    expect(checkSteps([])).toEqual(['Add at least one step.'])
    const perms = { print: 'full', extract: true, accessibility: true, annotate: true, form: true, assemble: true, modifyOther: true } as const
    expect(checkSteps([{ kind: 'watermark', text: ' ', fontSize: 40, color: '#000', opacity: 0.3, angle: 0, behind: true }])).toEqual(['Step 1: the watermark has no text.'])
    expect(checkSteps([{ kind: 'security', userPassword: 'x', ownerPassword: '', keyLength: 256, permissions: perms }, { kind: 'flatten' }])[0]).toMatch(/last step/)
    expect(checkSteps([{ kind: 'flatten' }, { kind: 'pdfa' }])).toEqual([])
  })
})

describe('runBatch', () => {
  it('reports each file, carries on after a failure, and can be cancelled', async () => {
    const files: Record<string, Uint8Array> = { a: await make(1), bad: new Uint8Array([1, 2, 3]), c: await make(1) }
    const written: string[] = []
    const io: BatchIO = {
      expand: async () => ['a', 'bad', 'c'],
      read: async (p) => ({ name: `${p}.pdf`, data: files[p] }),
      write: async (src, dir, suffix) => (written.push(`${src}${suffix}`), `${dir ?? '.'}/${src}${suffix}.pdf`)
    }
    const progress: number[] = []
    const res = await runBatch({ steps: [{ kind: 'flatten' }], inputs: ['x'], recursive: false, outDir: 'out', suffix: '_done' }, io, env, (d) => progress.push(d))
    expect(res.map((r) => r.ok)).toEqual([true, false, true])
    expect(res[1].error).toBeTruthy()
    expect(written).toEqual(['a_done', 'c_done'])
    expect(progress.at(-1)).toBe(3)

    let n = 0
    const some = await runBatch({ steps: [{ kind: 'flatten' }], inputs: ['x'], recursive: false, outDir: null, suffix: '' }, io, env, undefined, () => n++ >= 1)
    expect(some).toHaveLength(1)
  })
})
