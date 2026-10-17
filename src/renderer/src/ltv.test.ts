import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addValidationData, isCrl, isGoodOcspResponse, orderChain, parseCertificate, readValidationCounts, revocationPlan, revocationUrls } from './ltv'
import { prepareSignature, readSignatures, verifySignature } from './sign'
import { signCms, type SignSource } from '../../main/signing'

let dir = ''
const read = (n: string) => new Uint8Array(readFileSync(join(dir, n)))
let leaf: Uint8Array
let ca: Uint8Array
let ocspGood: Uint8Array
let crl: Uint8Array
let source: SignSource

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'openpdf-ltv-test-'))
  execFileSync('python', [
    '-c',
    `import sys, datetime, os
from cryptography import x509
from cryptography.x509 import ocsp
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID, AuthorityInformationAccessOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives.asymmetric import rsa
d = sys.argv[1]
now = datetime.datetime(2026, 1, 1)
def name(cn): return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Example Test")])
ck = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ca = x509.CertificateBuilder().subject_name(name("Test CA")).issuer_name(name("Test CA")).public_key(ck.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now).not_valid_after(datetime.datetime(2036,1,1)).add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(ck, hashes.SHA256())
lk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
leaf = (x509.CertificateBuilder().subject_name(name("Test Signer")).issuer_name(ca.subject).public_key(lk.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now).not_valid_after(datetime.datetime(2036,1,1))
  .add_extension(x509.AuthorityInformationAccess([x509.AccessDescription(AuthorityInformationAccessOID.OCSP, x509.UniformResourceIdentifier("http://ocsp.example.test/ocsp")), x509.AccessDescription(AuthorityInformationAccessOID.CA_ISSUERS, x509.UniformResourceIdentifier("http://ca.example.test/ca.cer"))]), critical=False)
  .add_extension(x509.CRLDistributionPoints([x509.DistributionPoint([x509.UniformResourceIdentifier("http://crl.example.test/ca.crl")], None, None, None), x509.DistributionPoint([x509.UniformResourceIdentifier("ldap://dir.example.test/cn=ca")], None, None, None)]), critical=False)
  .sign(ck, hashes.SHA256()))
open(os.path.join(d, 'leaf.der'), 'wb').write(leaf.public_bytes(serialization.Encoding.DER))
open(os.path.join(d, 'ca.der'), 'wb').write(ca.public_bytes(serialization.Encoding.DER))
resp = ocsp.OCSPResponseBuilder().add_response(cert=leaf, issuer=ca, algorithm=hashes.SHA1(), cert_status=ocsp.OCSPCertStatus.GOOD, this_update=now, next_update=datetime.datetime(2036,1,1), revocation_time=None, revocation_reason=None).responder_id(ocsp.OCSPResponderEncoding.HASH, ca).sign(ck, hashes.SHA256())
open(os.path.join(d, 'ocsp.der'), 'wb').write(resp.public_bytes(serialization.Encoding.DER))
crl = x509.CertificateRevocationListBuilder().issuer_name(ca.subject).last_update(now).next_update(datetime.datetime(2036,1,1)).sign(ck, hashes.SHA256())
open(os.path.join(d, 'ca.crl'), 'wb').write(crl.public_bytes(serialization.Encoding.DER))
sk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
sn = name("OpenPDF LTV Signer")
sc = x509.CertificateBuilder().subject_name(sn).issuer_name(sn).public_key(sk.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now).not_valid_after(datetime.datetime(2036,1,1)).sign(sk, hashes.SHA256())
open(os.path.join(d, 't.pfx'), 'wb').write(pkcs12.serialize_key_and_certificates(b"t", sk, sc, None, serialization.BestAvailableEncryption(b"pw")))`,
    dir
  ])
  leaf = read('leaf.der')
  ca = read('ca.der')
  ocspGood = read('ocsp.der')
  crl = read('ca.crl')
  source = { kind: 'pfx', data: read('t.pfx'), password: 'pw' }
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('what a certificate says about revocation', () => {
  it('lists the OCSP and CRL web addresses and leaves out other kinds', () => {
    const urls = revocationUrls(parseCertificate(leaf))
    expect(urls.ocsp).toEqual(['http://ocsp.example.test/ocsp'])
    expect(urls.crl).toEqual(['http://crl.example.test/ca.crl'])
  })

  it('orders a chain leaf first', () => {
    const certs = [parseCertificate(ca), parseCertificate(leaf)]
    const ordered = orderChain(certs)
    expect(ordered).toHaveLength(2)
    expect(ordered[0]).toBe(certs[1])
  })

  it('plans an OCSP request for the leaf and a fetch of the CRL, and none for the root', async () => {
    const plan = await revocationPlan([leaf, ca])
    expect(plan.map((p) => [p.kind, p.url])).toEqual([['ocsp', 'http://ocsp.example.test/ocsp'], ['crl', 'http://crl.example.test/ca.crl']])
    expect(plan[0].body!.length).toBeGreaterThan(20)
    expect(plan[1].body).toBeUndefined()
    expect(await revocationPlan([ca])).toEqual([])
    expect(await revocationPlan([leaf])).toEqual([]) // no issuer to ask on behalf of
  })

  it('accepts a good OCSP response and a CRL and refuses anything else', () => {
    expect(isGoodOcspResponse(ocspGood)).toBe(true)
    expect(isGoodOcspResponse(Uint8Array.from([0x30, 0x03, 0x0a, 0x01, 0x03]))).toBe(false) // tryLater
    expect(isGoodOcspResponse(new TextEncoder().encode('<html>no</html>'))).toBe(false)
    expect(isCrl(crl)).toBe(true)
    expect(isCrl(ocspGood)).toBe(false)
    expect(isCrl(new TextEncoder().encode('nope'))).toBe(false)
  })
})

describe('storing the proof in the file', () => {
  for (const objectStreams of [false, true]) {
    it(`appends a /DSS (${objectStreams ? 'cross-reference stream' : 'classic table'}) and keeps the file's bytes and its signature`, async () => {
      const doc = await PDFDocument.create()
      doc.addPage([300, 300])
      const original = await doc.save({ useObjectStreams: objectStreams })
      const prepared = await prepareSignature(original, { signerName: 'Test Signer', signedAt: new Date('2026-10-15T09:30:00Z') })
      const signed = prepared.finish(await signCms(prepared.toSign, source))

      const out = await addValidationData(signed, { certs: [leaf, ca], ocsps: [ocspGood], crls: [crl] })
      expect(out.subarray(0, signed.length)).toEqual(signed)
      expect(out.length).toBeGreaterThan(signed.length)
      expect(await readValidationCounts(out)).toEqual({ certs: 2, ocsps: 1, crls: 1 })
      // The signature still verifies, and the file still opens.
      const sig = (await readSignatures(out))[0]
      expect(await verifySignature(out, sig)).toMatchObject({ intact: true, signatureValid: true })
      expect((await PDFDocument.load(out)).getPageCount()).toBe(1)

      // A second update adds to the same lists.
      const again = await addValidationData(out, { certs: [], ocsps: [ocspGood], crls: [] })
      expect(await readValidationCounts(again)).toEqual({ certs: 2, ocsps: 2, crls: 1 })
      expect(await verifySignature(again, (await readSignatures(again))[0])).toMatchObject({ intact: true, signatureValid: true })
    })
  }

  it('leaves a file alone when there is nothing to add', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    const b = await doc.save()
    expect(await addValidationData(b, { certs: [], ocsps: [], crls: [] })).toBe(b)
  })
})
