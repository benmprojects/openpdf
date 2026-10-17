/**
 * Long-term validation (PAdES-LT style): the proof that the signer's certificates were good when the document was signed,
 * kept inside the file so it can still be checked after the certificate authority stops answering. For each certificate in
 * the signing chain this asks its OCSP responder (and fetches its certificate revocation list), and stores the answers
 * with the certificates in the catalogue's /DSS dictionary (ISO 32000-2 12.8.4.3), as an incremental update so that the
 * signatures already in the file stay valid.
 *
 * Fetching is done by the main process (see `sign:fetch-revocation`): this module only works out what to ask and what
 * to keep, and writes the file.
 */
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, type PDFContext, type PDFObject } from 'pdf-lib'
import { ensureCrypto, lastStartXref, serialise, usesXrefStream } from './sign'
import { stringToBytes } from './content'

const OID_AIA = '1.3.6.1.5.5.7.1.1'
const OID_CRL_DP = '2.5.29.31'
const OID_OCSP = '1.3.6.1.5.5.7.48.1'

const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
const der = (c: pkijs.Certificate): Uint8Array => new Uint8Array(c.toSchema().toBER(false))

export function parseCertificate(data: Uint8Array): pkijs.Certificate {
  const parsed = asn1js.fromBER(buf(data))
  if (parsed.offset === -1) throw new Error('A certificate could not be read.')
  return new pkijs.Certificate({ schema: parsed.result })
}

/** The certificates in a CMS signature, signer's first and then the issuers it leads to (anything unrelated is dropped). */
export function chainOfCms(cms: Uint8Array): Uint8Array[] {
  const parsed = asn1js.fromBER(buf(cms))
  if (parsed.offset === -1) throw new Error('The signature data could not be read.')
  const sd = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: parsed.result }).content })
  const certs = (sd.certificates ?? []).filter((x): x is pkijs.Certificate => x instanceof pkijs.Certificate)
  return orderChain(certs).map(der)
}

/** The leaf (a certificate no other one was issued by) first, then each issuer in turn. */
export function orderChain(certs: pkijs.Certificate[]): pkijs.Certificate[] {
  const leaf = certs.find((c) => !certs.some((o) => o !== c && o.issuer.isEqual(c.subject) && !o.subject.isEqual(o.issuer))) ?? certs[0]
  const out: pkijs.Certificate[] = []
  for (let cur: pkijs.Certificate | undefined = leaf; cur && !out.includes(cur) && out.length < 10; ) {
    out.push(cur)
    const issuer: pkijs.Certificate | undefined = certs.find((o) => o !== cur && cur!.issuer.isEqual(o.subject))
    cur = issuer
  }
  return out
}

const uriOf = (name: pkijs.GeneralName): string | undefined => {
  if (name.type !== 6) return undefined
  // pkijs keeps a URI as a plain string; older versions held an ASN.1 string.
  const raw = name.value as unknown
  const v = typeof raw === 'string' ? raw : (raw as { valueBlock?: { value?: string } } | undefined)?.valueBlock?.value
  return typeof v === 'string' ? v : undefined
}

/** The OCSP responder addresses and CRL addresses a certificate names (web addresses only). */
export function revocationUrls(cert: pkijs.Certificate): { ocsp: string[]; crl: string[] } {
  const ocsp: string[] = []
  const crl: string[] = []
  for (const ext of cert.extensions ?? []) {
    if (ext.extnID === OID_AIA) {
      const info = ext.parsedValue as pkijs.InfoAccess | undefined
      for (const d of info?.accessDescriptions ?? []) {
        const u = d.accessMethod === OID_OCSP ? uriOf(d.accessLocation) : undefined
        if (u && /^https?:\/\//i.test(u)) ocsp.push(u)
      }
    } else if (ext.extnID === OID_CRL_DP) {
      const dps = ext.parsedValue as pkijs.CRLDistributionPoints | undefined
      for (const dp of dps?.distributionPoints ?? []) {
        const names = Array.isArray(dp.distributionPoint) ? dp.distributionPoint : []
        for (const n of names) {
          const u = n instanceof pkijs.GeneralName ? uriOf(n) : undefined
          if (u && /^https?:\/\//i.test(u)) crl.push(u)
        }
      }
    }
  }
  return { ocsp: [...new Set(ocsp)], crl: [...new Set(crl)] }
}

export interface RevocationRequest {
  kind: 'ocsp' | 'crl'
  url: string
  /** The OCSP request (DER) to POST; absent for a CRL, which is fetched with GET. */
  body?: Uint8Array
}

/** What to ask for the chain: an OCSP request to each responder, and each CRL address. The last certificate (the root) is not asked about. */
export async function revocationPlan(chain: Uint8Array[]): Promise<RevocationRequest[]> {
  ensureCrypto()
  const certs = chain.map(parseCertificate)
  const out: RevocationRequest[] = []
  const seen = new Set<string>()
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i]
    const issuer = certs.find((o) => o !== cert && cert.issuer.isEqual(o.subject))
    if (!issuer) continue
    const { ocsp, crl } = revocationUrls(cert)
    for (const url of ocsp) {
      const req = new pkijs.OCSPRequest()
      await req.createForCertificate(cert, { hashAlgorithm: 'SHA-1', issuerCertificate: issuer })
      const body = new Uint8Array(req.toSchema(true).toBER(false))
      out.push({ kind: 'ocsp', url, body })
    }
    for (const url of crl) {
      if (seen.has(url)) continue
      seen.add(url)
      out.push({ kind: 'crl', url })
    }
  }
  return out
}

/** Whether bytes are a successful OCSP response (status "successful", with response bytes). */
export function isGoodOcspResponse(data: Uint8Array): boolean {
  try {
    const parsed = asn1js.fromBER(buf(data))
    if (parsed.offset === -1) return false
    const r = new pkijs.OCSPResponse({ schema: parsed.result })
    return r.responseStatus.valueBlock.valueDec === 0 && !!r.responseBytes
  } catch {
    return false
  }
}

/** Whether bytes are a certificate revocation list. */
export function isCrl(data: Uint8Array): boolean {
  try {
    const parsed = asn1js.fromBER(buf(data))
    if (parsed.offset === -1) return false
    new pkijs.CertificateRevocationList({ schema: parsed.result })
    return true
  } catch {
    return false
  }
}

export interface ValidationData {
  certs: Uint8Array[]
  ocsps: Uint8Array[]
  crls: Uint8Array[]
}

const N = PDFName.of

/** The array under `key` in `dict`, made if missing; an indirect one is marked changed. */
function arrayAt(ctx: PDFContext, dict: PDFDict, key: string, dirty: Set<PDFRef>): PDFArray {
  const raw = dict.get(N(key))
  if (raw instanceof PDFRef) {
    const o = ctx.lookup(raw)
    if (o instanceof PDFArray) {
      dirty.add(raw)
      return o
    }
  } else if (raw instanceof PDFArray) return raw
  const fresh = ctx.obj([])
  dict.set(N(key), fresh)
  return fresh
}

/** Adds the data to the file's /DSS as an incremental update; the original bytes are kept exactly. */
export async function addValidationData(bytes: Uint8Array, data: ValidationData): Promise<Uint8Array> {
  if (!data.certs.length && !data.ocsps.length && !data.crls.length) return bytes
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const root = ctx.trailerInfo.Root as PDFRef | undefined
  if (!root) throw new Error('This file has no document catalogue.')
  const dirty = new Set<PDFRef>([root])
  const fresh: [PDFRef, PDFObject][] = []

  const catalog = doc.catalog
  let dss = catalog.lookupMaybe(N('DSS'), PDFDict)
  const dssRaw = catalog.get(N('DSS'))
  if (dssRaw instanceof PDFRef) dirty.add(dssRaw)
  if (!dss) {
    dss = ctx.obj({}) as PDFDict
    catalog.set(N('DSS'), dss)
  }
  const store = (key: 'Certs' | 'OCSPs' | 'CRLs', items: Uint8Array[]) => {
    if (!items.length) return
    const arr = arrayAt(ctx, dss!, key, dirty)
    for (const item of items) {
      const stream = ctx.stream(item)
      const ref = ctx.register(stream)
      fresh.push([ref, stream])
      arr.push(ref)
    }
  }
  store('Certs', data.certs)
  store('OCSPs', data.ocsps)
  store('CRLs', data.crls)

  // ---- Write the update ----------------------------------------------------------------------------
  const prev = lastStartXref(bytes)
  const asStream = usesXrefStream(bytes, prev)
  const parts: Uint8Array[] = []
  let at = bytes.length
  if (bytes[bytes.length - 1] !== 0x0a && bytes[bytes.length - 1] !== 0x0d) {
    parts.push(stringToBytes('\n'))
    at += 1
  }
  const entries: { num: number; offset: number; gen: number }[] = []
  const add = (ref: PDFRef, obj: PDFObject) => {
    const d = serialise(ref, obj)
    entries.push({ num: ref.objectNumber, offset: at, gen: ref.generationNumber })
    parts.push(d)
    at += d.length
  }
  for (const ref of dirty) {
    const o = ctx.lookup(ref)
    if (o) add(ref, o)
  }
  // The DSS dictionary itself when it is a new direct object of the catalogue, it is written with the catalogue; arrays that are direct are written with their owner.
  for (const [ref, obj] of fresh) add(ref, obj)

  const sorted = [...entries].sort((a, b) => a.num - b.num)
  const extras: string[] = []
  if (ctx.trailerInfo.Info) extras.push(`/Info ${ctx.trailerInfo.Info.toString()}`)
  if (ctx.trailerInfo.ID) extras.push(`/ID ${ctx.trailerInfo.ID.toString()}`)
  const size = ctx.largestObjectNumber + 1

  if (!asStream) {
    const xrefAt = at
    let table = 'xref\n'
    for (let i = 0; i < sorted.length; ) {
      let j = i
      while (j + 1 < sorted.length && sorted[j + 1].num === sorted[j].num + 1) j++
      table += `${sorted[i].num} ${j - i + 1}\n`
      for (let k = i; k <= j; k++) table += `${String(sorted[k].offset).padStart(10, '0')} ${String(sorted[k].gen).padStart(5, '0')} n \n`
      i = j + 1
    }
    table += `trailer\n<< /Size ${size} /Root ${root.toString()} ${extras.join(' ')} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`
    parts.push(stringToBytes(table))
  } else {
    const xrefRef = ctx.nextRef()
    const xrefAt = at
    sorted.push({ num: xrefRef.objectNumber, offset: xrefAt, gen: 0 })
    const index: number[] = []
    const rows: number[] = []
    for (let i = 0; i < sorted.length; ) {
      let j = i
      while (j + 1 < sorted.length && sorted[j + 1].num === sorted[j].num + 1) j++
      index.push(sorted[i].num, j - i + 1)
      for (let k = i; k <= j; k++) rows.push(1, (sorted[k].offset >>> 24) & 255, (sorted[k].offset >>> 16) & 255, (sorted[k].offset >>> 8) & 255, sorted[k].offset & 255, (sorted[k].gen >> 8) & 255, sorted[k].gen & 255)
      i = j + 1
    }
    const body = Uint8Array.from(rows)
    parts.push(
      stringToBytes(`${xrefRef.objectNumber} 0 obj\n<< /Type /XRef /Size ${ctx.largestObjectNumber + 1} /W [1 4 2] /Index [${index.join(' ')}] /Root ${root.toString()} ${extras.join(' ')} /Prev ${prev} /Length ${body.length} >>\nstream\n`),
      body,
      stringToBytes(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`)
    )
  }
  let total = bytes.length
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  out.set(bytes, 0)
  let w = bytes.length
  for (const p of parts) {
    out.set(p, w)
    w += p.length
  }
  return out
}

/** Reads back what a file's /DSS holds (counts), to say what was kept. */
export async function readValidationCounts(bytes: Uint8Array): Promise<{ certs: number; ocsps: number; crls: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const dss = doc.catalog.lookupMaybe(N('DSS'), PDFDict)
  const n = (key: string) => dss?.lookupMaybe(N(key), PDFArray)?.size() ?? 0
  return { certs: n('Certs'), ocsps: n('OCSPs'), crls: n('CRLs') }
}
