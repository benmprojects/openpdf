import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chainStatus, listCertificates, signCms, type SignSource } from '../../main/signing'
import { addTimestamp, buildTimestampRequest, prepareSignature, readSignatures, verifySignature, type Prepared, type SignOptions } from './sign'

let dir = ''
let source: SignSource

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'openpdf-sign-test-'))
  const pfx = join(dir, 't.pfx')
  execFileSync('python', [
    '-c',
    `import sys, datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives.asymmetric import rsa
k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "OpenPDF Test Signer"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Example Test")])
c = x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(datetime.datetime(2026,1,1)).not_valid_after(datetime.datetime(2036,1,1)).sign(k, hashes.SHA256())
open(sys.argv[1], 'wb').write(pkcs12.serialize_key_and_certificates(b"t", k, c, None, serialization.BestAvailableEncryption(b"pw")))`,
    pfx
  ])
  source = { kind: 'pfx', data: new Uint8Array(readFileSync(pfx)), password: 'pw' }
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function makePdf(objectStreams: boolean, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  page.drawText('Contract text', { x: 50, y: 200 })
  if (rotate) page.setRotation({ type: 'degrees', angle: rotate } as never)
  doc.addPage([300, 300])
  return doc.save({ useObjectStreams: objectStreams })
}

const opts = (over: Partial<SignOptions> = {}): SignOptions => ({ signerName: 'OpenPDF Test Signer', signedAt: new Date('2026-10-15T09:30:00Z'), ...over })

async function signed(bytes: Uint8Array, o: SignOptions): Promise<{ out: Uint8Array; prepared: Prepared }> {
  const prepared = await prepareSignature(bytes, o)
  const cms = await signCms(prepared.toSign, source)
  return { out: prepared.finish(cms), prepared }
}

describe('signing', () => {
  for (const [label, objectStreams] of [['a classic cross-reference table', false], ['a cross-reference stream', true]] as const) {
    it(`signs a file with ${label}, keeping its bytes, and verifies`, async () => {
      const original = await makePdf(objectStreams)
      const { out } = await signed(original, opts({ reason: 'I approve', location: 'Brisbane' }))
      expect(out.subarray(0, original.length)).toEqual(original)
      const sigs = await readSignatures(out)
      expect(sigs).toHaveLength(1)
      expect(sigs[0]).toMatchObject({ fieldName: 'Signature1', name: 'OpenPDF Test Signer', reason: 'I approve', location: 'Brisbane' })
      const check = await verifySignature(out, sigs[0])
      expect(check).toMatchObject({ intact: true, signatureValid: true, coversWholeFile: true, hash: 'SHA-256' })
      expect(check.signer).toMatchObject({ commonName: 'OpenPDF Test Signer', organisation: 'Example Test' })
      expect(check.signingTime).toBeInstanceOf(Date)
      expect(check.certificates.length).toBeGreaterThan(0)
      // Still a valid PDF with its two pages.
      expect((await PDFDocument.load(out)).getPageCount()).toBe(2)
    })
  }

  it('notices a change inside the signed bytes', async () => {
    const { out } = await signed(await makePdf(false), opts())
    const sig = (await readSignatures(out))[0]
    const bad = out.slice()
    bad[20] ^= 0xff
    const check = await verifySignature(bad, sig)
    expect(check.intact).toBe(false)
    expect(check.problem).toMatch(/changed after/)
  })

  it('keeps an earlier signature valid when a second is added, and says it no longer covers the end', async () => {
    const first = (await signed(await makePdf(false), opts({ signerName: 'First' }))).out
    const both = (await signed(first, opts({ signerName: 'Second' }))).out
    const sigs = await readSignatures(both)
    expect(sigs.map((s) => s.fieldName)).toEqual(['Signature1', 'Signature2'])
    const [a, b] = await Promise.all(sigs.map((s) => verifySignature(both, s)))
    expect(a).toMatchObject({ intact: true, signatureValid: true, coversWholeFile: false })
    expect(b).toMatchObject({ intact: true, signatureValid: true, coversWholeFile: true })
  })

  it('writes a visible signature and a certifying one that the file still opens with', async () => {
    const { out } = await signed(await makePdf(true, 90), opts({ visible: { page: 0, rect: { x: 20, y: 20, w: 160, h: 50 } }, reason: 'Reviewed', certify: 2 }))
    const sigs = await readSignatures(out)
    expect(sigs[0].certify).toBe(2)
    expect(await verifySignature(out, sigs[0])).toMatchObject({ intact: true, signatureValid: true })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
  })

  it('adds a time-stamp from a time-stamping server (skipped when the server cannot be reached)', async (ctx) => {
    const prepared = await prepareSignature(await makePdf(true), opts())
    const cms = await signCms(prepared.toSign, source)
    const request = await buildTimestampRequest(cms)
    let response: Uint8Array
    try {
      const res = await fetch('http://timestamp.digicert.com', { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body: Buffer.from(request), signal: AbortSignal.timeout(10000) })
      if (!res.ok) return ctx.skip()
      response = new Uint8Array(await res.arrayBuffer())
    } catch {
      return ctx.skip()
    }
    const out = prepared.finish(addTimestamp(cms, response))
    const sigs = await readSignatures(out)
    const check = await verifySignature(out, sigs[0])
    expect(check).toMatchObject({ intact: true, signatureValid: true, timestamped: true })
    expect(check.timestamp?.valid).toBe(true)
    expect(Math.abs(Date.now() - check.timestamp!.time.getTime())).toBeLessThan(10 * 60 * 1000)
  })

  it('lists the certificates in the Windows store (read only) and says whether Windows trusts a self-signed one', async () => {
    const list = await listCertificates()
    expect(Array.isArray(list)).toBe(true)
    for (const c of list) expect(c).toMatchObject({ hasKey: true })
    const prepared = await prepareSignature(await makePdf(false), opts())
    const out = prepared.finish(await signCms(prepared.toSign, source))
    const check = await verifySignature(out, (await readSignatures(out))[0])
    const chain = await chainStatus(check.certificates)
    expect(chain.trusted).toBe(false)
    expect(chain.status).toContain('UntrustedRoot')
  })
})
