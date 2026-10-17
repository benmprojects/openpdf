import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadPdf } from './download'
import { checkPdfUrl, fileNameFor, looksLikePdf } from '../shared/openUrl'

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openpdf-dl-test-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const serve = (body: BodyInit | null, init?: ResponseInit) => (async () => new Response(body, init)) as unknown as typeof fetch

describe('checking an address', () => {
  it('accepts https and adds it when missing', () => {
    expect(checkPdfUrl(' https://example.test/a/b.pdf ')).toMatchObject({ ok: true })
    expect(checkPdfUrl('example.test/b.pdf')).toMatchObject({ ok: true })
  })
  it('refuses http, other schemes, passwords and nonsense with a reason', () => {
    expect(checkPdfUrl('http://example.test/a.pdf')).toMatchObject({ ok: false, error: expect.stringContaining('https://') })
    expect(checkPdfUrl('file:///C:/a.pdf')).toMatchObject({ ok: false })
    expect(checkPdfUrl('ftp://example.test/a.pdf')).toMatchObject({ ok: false })
    expect(checkPdfUrl('https://user:pw@example.test/a.pdf')).toMatchObject({ ok: false })
    expect(checkPdfUrl('   ')).toMatchObject({ ok: false })
    expect(checkPdfUrl('https://')).toMatchObject({ ok: false })
  })
})

describe('file names and PDF detection', () => {
  const u = new URL('https://example.test/files/Site%20plan.pdf?x=1')
  it('uses the path, or the server\'s name, and makes it safe', () => {
    expect(fileNameFor(u)).toBe('Site plan.pdf')
    expect(fileNameFor(new URL('https://example.test/get?id=4'))).toBe('get.pdf')
    expect(fileNameFor(new URL('https://example.test/'))).toBe('download.pdf')
    expect(fileNameFor(u, 'attachment; filename="..\\evil:name.pdf"')).toBe('_evil_name.pdf')
    expect(fileNameFor(u, "attachment; filename*=UTF-8''Caf%C3%A9.pdf")).toBe('Café.pdf')
  })
  it('knows a PDF by its header', () => {
    expect(looksLikePdf(PDF)).toBe(true)
    expect(looksLikePdf(new TextEncoder().encode('<html>'))).toBe(false)
  })
})

describe('downloading', () => {
  it('returns a PDF and leaves no temporary files', async () => {
    const r = await downloadPdf('https://example.test/plan.pdf', serve(PDF, { status: 200 }), { tmpRoot: root })
    expect(r).toMatchObject({ ok: true, name: 'plan.pdf' })
    expect(r.ok && r.data.length).toBe(PDF.length)
    expect(readdirSync(root)).toEqual([])
  })
  it('says so when the server refuses or the file is missing', async () => {
    const r = await downloadPdf('https://example.test/none.pdf', serve('', { status: 404, statusText: 'Not Found' }), { tmpRoot: root })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('no file at that address') })
    expect(await downloadPdf('https://example.test/x.pdf', serve('', { status: 403 }), { tmpRoot: root })).toMatchObject({ ok: false, error: expect.stringContaining('sign in') })
  })
  it('stops at the size limit, by header or by counting', async () => {
    const big = new Uint8Array(5000).fill(65)
    expect(await downloadPdf('https://example.test/b.pdf', serve(big, { status: 200, headers: { 'content-length': '5000' } }), { tmpRoot: root, maxBytes: 1000 })).toMatchObject({ ok: false, error: expect.stringContaining('larger than') })
    // No length declared: the bytes are counted as they arrive.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(big.subarray(0, 1000))
        c.close()
      }
    })
    expect(await downloadPdf('https://example.test/b.pdf', serve(stream, { status: 200 }), { tmpRoot: root, maxBytes: 2500 })).toMatchObject({ ok: false, error: expect.stringContaining('larger than') })
    expect(readdirSync(root)).toEqual([])
  })
  it('refuses something that is not a PDF', async () => {
    expect(await downloadPdf('https://example.test/p.pdf', serve('<html>sign in</html>', { status: 200 }), { tmpRoot: root })).toMatchObject({ ok: false, error: 'That address did not return a PDF document.' })
  })
  it('reports a connection failure and a timeout in plain words', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await downloadPdf('https://example.test/p.pdf', down, { tmpRoot: root })).toMatchObject({ ok: false, error: expect.stringContaining('Could not reach example.test') })
    const slow = (async () => {
      throw new DOMException('timed out', 'TimeoutError')
    }) as unknown as typeof fetch
    expect(await downloadPdf('https://example.test/p.pdf', slow, { tmpRoot: root })).toMatchObject({ ok: false, error: expect.stringContaining('too long') })
  })
  it('never fetches an http address', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return new Response(PDF)
    }) as unknown as typeof fetch
    expect(await downloadPdf('http://example.test/p.pdf', spy, { tmpRoot: root })).toMatchObject({ ok: false })
    expect(called).toBe(false)
  })
})
