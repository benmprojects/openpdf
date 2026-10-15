/**
 * Seeded fuzz tests for the parsers that read untrusted input: page range text, FDF files, page labels and
 * bookmarks, PNG prediction, qpdf's JSON and the font registry. Each must either give a sane result or throw a
 * plain Error; never hang, never throw something else. Seeds are fixed so a failure reproduces.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { parseFontRegistry } from '../../shared/fontMatch'
import { parseEncryptionJson } from '../../shared/pdfSecurity'
import { fromFdf, toFdf, type Norm } from './interchange'
import { unpredictPng } from './optimise'
import { readLabelRanges, writeLabelRanges, writeOutline } from './outlineEdit'
import { parsePageRanges } from './pageOps'

/** Small fast PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  return { next, int, pick: <T,>(xs: readonly T[]) => xs[int(xs.length)] }
}

/** A damaged copy: flipped bytes, cut or repeated spans, or a truncation. */
function mutate(data: Uint8Array, r: ReturnType<typeof rng>): Uint8Array {
  let out = Uint8Array.from(data)
  const steps = 1 + r.int(4)
  for (let s = 0; s < steps && out.length; s++) {
    const at = r.int(out.length)
    const kind = r.int(5)
    if (kind === 0) out[at] = r.int(256)
    else if (kind === 1) out[at] ^= 1 << r.int(8)
    else if (kind === 2) out = Uint8Array.from([...out.subarray(0, at), ...out.subarray(Math.min(out.length, at + 1 + r.int(64)))])
    else if (kind === 3) {
      const len = 1 + r.int(64)
      out = Uint8Array.from([...out.subarray(0, at), ...out.subarray(at, at + len), ...out.subarray(at)])
    } else out = out.subarray(0, at)
  }
  return out
}

/** Runs `fn`; passes when it returns or throws an Error, fails on anything else. */
async function survives(fn: () => unknown): Promise<void> {
  try {
    await fn()
  } catch (e) {
    if (!(e instanceof Error)) throw new Error(`threw a non-Error: ${String(e)}`, { cause: e })
  }
}

describe('fuzz', () => {
  it('page range text', () => {
    const r = rng(1)
    const alphabet = ['1', '2', '9', '0', '-', ',', ' ', 'a', '99999999999', '–', '\u0000', '5-', '-3']
    for (let i = 0; i < 3000; i++) {
      const text = Array.from({ length: r.int(12) }, () => r.pick(alphabet)).join('')
      const count = 1 + r.int(50)
      try {
        const pages = parsePageRanges(text, count)
        expect(pages.length).toBeGreaterThan(0)
        expect(pages.every((p) => Number.isInteger(p) && p >= 0 && p < count)).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
      }
    }
  })

  it('FDF comment files', async () => {
    const norms: Norm[] = [
      { subtype: 'Square', page: 0, rect: [10, 10, 100, 100], color: [1, 0, 0], contents: 'Box', author: 'A', name: 'n1' },
      { subtype: 'Text', page: 0, rect: [200, 200, 220, 220], contents: 'Note — ünïcode', name: 'n2' }
    ]
    const good = toFdf(norms, 'x.pdf')
    expect((await fromFdf(good)).length).toBe(2)
    const r = rng(2)
    for (let i = 0; i < 300; i++) await survives(() => fromFdf(mutate(good, r)))
  })

  it('page labels and bookmarks in damaged PDFs', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 4; i++) doc.addPage([300, 300]).drawText(`Page ${i + 1}`, { x: 20, y: 150, font, size: 18 })
    let good = await doc.save({ useObjectStreams: false })
    good = await writeLabelRanges(good, [{ start: 0, style: 'r', prefix: '', first: 1 }, { start: 2, style: 'D', prefix: 'A-', first: 1 }])
    good = await writeOutline(good, [{ title: 'One', page: 0, children: [{ title: 'Inner', page: 1, children: [] }] }])
    expect((await readLabelRanges(good)).length).toBe(2)
    const r = rng(3)
    for (let i = 0; i < 150; i++) {
      const bad = mutate(good, r)
      await survives(async () => {
        const ranges = await readLabelRanges(bad)
        for (const x of ranges) expect(Number.isFinite(x.start)).toBe(true)
      })
      await survives(() => writeOutline(bad, [{ title: 'T', page: 0, children: [] }]))
    }
  })

  it('PNG prediction on random rows', () => {
    const r = rng(4)
    for (let i = 0; i < 2000; i++) {
      const columns = 1 + r.int(16)
      const bpp = 1 + r.int(4)
      const data = Uint8Array.from({ length: r.int(200) }, () => (r.int(4) === 0 ? r.int(6) : r.int(256)))
      const out = unpredictPng(data, columns, bpp)
      if (out) expect(out.length % (columns * bpp)).toBe(0)
    }
  })

  it('qpdf JSON and the font registry', () => {
    const r = rng(5)
    const json = JSON.stringify({ encrypt: { encrypted: true, userpasswordmatched: true, ownerpasswordmatched: false, capabilities: { print: true, modify: false }, parameters: { method: 'AESv3', bits: 256 } } })
    const fonts = 'Arial (TrueType)    REG_SZ    arial.ttf\r\nArial Bold (TrueType)    REG_SZ    arialbd.ttf\r\n'
    const enc = new TextEncoder()
    const dec = new TextDecoder()
    for (let i = 0; i < 1500; i++) {
      const j = dec.decode(mutate(enc.encode(json), r))
      try {
        parseEncryptionJson(j, r.pick([0, 2, 3]))
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
      }
      const list = parseFontRegistry(dec.decode(mutate(enc.encode(fonts), r)))
      expect(Array.isArray(list)).toBe(true)
    }
  })
})
