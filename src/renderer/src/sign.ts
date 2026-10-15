/**
 * Digital signatures (ISO 32000 12.8, PAdES-style detached CMS). A signature is added as an incremental update: the
 * original bytes are kept exactly as they were, and only the changed objects, a new cross-reference section and a
 * trailer are appended. That keeps earlier signatures valid and lets the new one cover the whole file.
 *
 * `prepareSignature` writes the update with an empty, fixed-size /Contents and a patched /ByteRange and hands back
 * the bytes to be signed; the CMS blob comes from outside (the main process, through Windows' certificate APIs) and
 * `finish` pastes it in. `readSignatures` and `verifySignature` go the other way for a signed file.
 */
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFContext, type PDFObject } from 'pdf-lib'
import { frameFor } from './annotWrite'
import { matMul, stringToBytes } from './content'
import type { Rect } from './textLogic'

const N = PDFName.of

export type CertifyLevel = 1 | 2 | 3

export interface SignOptions {
  /** Shown in the signature panel and on a visible signature. */
  signerName: string
  reason?: string
  location?: string
  contact?: string
  signedAt: Date
  /** A visible signature: the page (zero-based) and a box in display space. Omitted for an invisible one. */
  visible?: { page: number; rect: Rect }
  /** Certify the document: 1 no changes, 2 form filling and signing, 3 also comments. */
  certify?: CertifyLevel
  /** Room for the CMS blob in bytes (the placeholder is twice this in hex). */
  contentsBytes?: number
}

export interface Prepared {
  /** The file with the signature's slot in place: what would be saved if the signature had no contents. */
  bytes: Uint8Array
  /** What the signature covers (the file except the slot), to be signed. */
  toSign: Uint8Array
  /** The signed file with the CMS blob in the slot. */
  finish(cms: Uint8Array): Uint8Array
  fieldName: string
}

export const DEFAULT_CONTENTS_BYTES = 20000

const latin1 = (s: string): Uint8Array => stringToBytes(s)
const pad10 = (n: number) => String(n).padStart(10, '0')

/** The PDF date string for a Date: D:YYYYMMDDHHmmSSOHH'mm' */
export function pdfDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const a = Math.abs(off)
  return `D:${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}'${p(a % 60)}'`
}

/** Characters a standard Helvetica appearance can show; anything else becomes '?'. */
const winAnsi = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
const escapeText = (s: string) => winAnsi(s).replace(/([\\()])/g, '\\$1')

/** Wraps text to a width using an average glyph width of 0.5 em (Helvetica is a little narrower than that for most text). */
function wrapLines(lines: string[], width: number, size: number): string[] {
  const per = Math.max(4, Math.floor(width / (size * 0.5)))
  const out: string[] = []
  for (const line of lines) {
    let cur = ''
    for (const word of line.split(/\s+/)) {
      if (!word) continue
      if ((cur ? cur.length + 1 : 0) + word.length > per && cur) {
        out.push(cur)
        cur = word
      } else cur = cur ? `${cur} ${word}` : word
    }
    out.push(cur)
  }
  return out
}

/** Looks up the object a key holds, to edit it in place and report which indirect object it lives in. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function child<T extends PDFDict | PDFArray>(ctx: PDFContext, owner: PDFDict, key: string, kind: Function & { prototype: T }, make: () => T, dirty: Set<PDFRef>): T {
  const raw = owner.get(N(key))
  if (raw instanceof PDFRef) {
    const o = ctx.lookup(raw)
    if (o instanceof kind) {
      dirty.add(raw)
      return o as unknown as T
    }
  } else if (raw instanceof kind) return raw as unknown as T
  const fresh = make()
  owner.set(N(key), fresh)
  return fresh
}

/** The bytes of one indirect object as it is written in an update. */
function serialise(ref: PDFRef, obj: PDFObject): Uint8Array {
  const head = `${ref.objectNumber} ${ref.generationNumber} obj\n`
  if (obj instanceof PDFRawStream) {
    const dict = obj.dict
    dict.set(N('Length'), PDFNumber.of(obj.contents.length))
    const a = latin1(`${head}${dict.toString()}\nstream\n`)
    const b = latin1('\nendstream\nendobj\n')
    const out = new Uint8Array(a.length + obj.contents.length + b.length)
    out.set(a, 0)
    out.set(obj.contents, a.length)
    out.set(b, a.length + obj.contents.length)
    return out
  }
  if (obj instanceof PDFStream) throw new Error('Unsupported stream in a signature update.')
  return latin1(`${head}${obj.toString()}\nendobj\n`)
}

function lastStartXref(bytes: Uint8Array): number {
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 2048)))
  const m = [...tail.matchAll(/startxref\s+(\d+)/g)].pop()
  if (!m) throw new Error('This file has no cross-reference section to build on.')
  return Number(m[1])
}

const usesXrefStream = (bytes: Uint8Array, at: number): boolean => {
  const head = new TextDecoder('latin1').decode(bytes.subarray(at, at + 20)).trimStart()
  return !head.startsWith('xref')
}

/** Names of the fields in a form, to pick an unused signature field name. */
function fieldNames(doc: PDFDocument): Set<string> {
  const out = new Set<string>()
  const walk = (arr: PDFArray | undefined, prefix: string) => {
    if (!arr) return
    for (let i = 0; i < arr.size(); i++) {
      const f = arr.lookupMaybe(i, PDFDict)
      if (!f) continue
      const t = f.lookup(N('T'))
      const name = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : ''
      const full = prefix ? `${prefix}.${name}` : name
      out.add(full)
      walk(f.lookupMaybe(N('Kids'), PDFArray), full)
    }
  }
  walk(doc.catalog.lookupMaybe(N('AcroForm'), PDFDict)?.lookupMaybe(N('Fields'), PDFArray), '')
  return out
}

/** Appearance of a visible signature: a framed box with who signed, when, why and where. */
function appearance(ctx: PDFContext, w: number, h: number, matrix: number[], lines: string[]): PDFRef {
  const size = Math.max(6, Math.min(10, h / Math.max(2, lines.length) - 1))
  const wrapped = wrapLines(lines, w - 6, size).slice(0, Math.max(1, Math.floor((h - 4) / (size * 1.2))))
  let content = `q 1 1 1 rg 0 0 ${w} ${h} re f 0.1 0.25 0.55 RG 0.75 w 0.5 0.5 ${w - 1} ${h - 1} re S Q\nBT /Helv ${size} Tf 0.05 0.1 0.3 rg ${size * 1.2} TL 3 ${h - size - 1} Td\n`
  for (const l of wrapped) content += `(${escapeText(l)}) Tj T*\n`
  content += 'ET'
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }))
  const stream = ctx.stream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, w, h],
    Matrix: matrix,
    Resources: { Font: { Helv: font } }
  })
  return ctx.register(stream)
}

/**
 * Appends a signature field and an empty signature to `bytes` as an incremental update. Throws for an encrypted
 * file (it is decrypted in memory, so there is nothing to sign in place).
 */
export async function prepareSignature(bytes: Uint8Array, o: SignOptions): Promise<Prepared> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const root = ctx.trailerInfo.Root as PDFRef | undefined
  if (!root) throw new Error('This file has no document catalogue.')
  const dirty = new Set<PDFRef>()
  const size = o.contentsBytes ?? DEFAULT_CONTENTS_BYTES

  const names = fieldNames(doc)
  let n = 1
  while (names.has(`Signature${n}`)) n++
  const fieldName = `Signature${n}`

  // The signature dictionary: byte range and contents are placeholders of the final width.
  const sig = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 1111111111, 2222222222, 3333333333],
    M: PDFString.of(pdfDate(o.signedAt)),
    Name: PDFHexString.fromText(o.signerName)
  })
  sig.set(N('Contents'), PDFHexString.of('0'.repeat(size * 2)))
  if (o.reason) sig.set(N('Reason'), PDFHexString.fromText(o.reason))
  if (o.location) sig.set(N('Location'), PDFHexString.fromText(o.location))
  if (o.contact) sig.set(N('ContactInfo'), PDFHexString.fromText(o.contact))
  if (o.certify) {
    sig.set(
      N('Reference'),
      ctx.obj([{ Type: 'SigRef', TransformMethod: 'DocMDP', TransformParams: { Type: 'TransformParams', P: o.certify, V: '1.2' } }])
    )
  }
  const sigRef = ctx.register(sig)

  // The field and its widget (one dictionary), on the chosen page or the first.
  const pageIndex = o.visible?.page ?? 0
  const page = doc.getPage(pageIndex)
  let rect: [number, number, number, number] = [0, 0, 0, 0]
  let ap: PDFRef | undefined
  if (o.visible) {
    const cb = page.getCropBox()
    const rotation = page.getRotation().angle
    const f = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, rotation).m
    const toUser = (x: number, y: number): [number, number] => [f[0] * x + f[2] * y + f[4], f[1] * x + f[3] * y + f[5]]
    const a = toUser(o.visible.rect.x, o.visible.rect.y)
    const b = toUser(o.visible.rect.x + o.visible.rect.w, o.visible.rect.y + o.visible.rect.h)
    rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
    const w = o.visible.rect.w
    const h = o.visible.rect.h
    const lines = [`Digitally signed by ${o.signerName}`, `Date: ${o.signedAt.toLocaleString('en-AU')}`, ...(o.reason ? [`Reason: ${o.reason}`] : []), ...(o.location ? [`Location: ${o.location}`] : [])]
    // Local coordinates (y up, origin bottom-left of the box) to the page, so the text stays upright on rotated pages.
    const m = matMul([1, 0, 0, -1, 0, h], [f[0], f[1], f[2], f[3], 0, 0])
    ap = appearance(ctx, w, h, m.slice(0, 4).concat([0, 0]), lines)
  }
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of(fieldName),
    V: sigRef,
    Rect: rect,
    F: 132,
    P: page.ref
  })
  if (ap) widget.set(N('AP'), ctx.obj({ N: ap }))
  const widgetRef = ctx.register(widget)

  // On the page.
  const annots = child(ctx, page.node, 'Annots', PDFArray, () => ctx.obj([]), dirty)
  annots.push(widgetRef)
  dirty.add(page.ref)

  // In the form (created when there is none), flagged as holding signatures that later changes must not remove.
  const catalog = doc.catalog
  const form = child(ctx, catalog, 'AcroForm', PDFDict, () => ctx.obj({}), dirty)
  const fields = child(ctx, form, 'Fields', PDFArray, () => ctx.obj([]), dirty)
  fields.push(widgetRef)
  form.set(N('SigFlags'), PDFNumber.of(3))
  dirty.add(root)

  if (o.certify) catalog.set(N('Perms'), ctx.obj({ DocMDP: sigRef }))

  // ---- Write the update ---------------------------------------------------------------------------
  const prev = lastStartXref(bytes)
  const asStream = usesXrefStream(bytes, prev)
  const parts: Uint8Array[] = []
  let at = bytes.length
  const nl = bytes[bytes.length - 1] === 0x0a || bytes[bytes.length - 1] === 0x0d ? new Uint8Array(0) : latin1('\n')
  if (nl.length) {
    parts.push(nl)
    at += nl.length
  }
  const entries: { num: number; offset: number; gen: number }[] = []
  const add = (ref: PDFRef, obj: PDFObject): number => {
    const data = serialise(ref, obj)
    entries.push({ num: ref.objectNumber, offset: at, gen: ref.generationNumber })
    parts.push(data)
    at += data.length
    return at - data.length
  }
  // Objects in a fixed order: changed existing ones, then the new ones.
  const changed = [...dirty].filter((r) => ctx.lookup(r))
  for (const ref of changed) add(ref, ctx.lookup(ref)!)
  const sigAt = add(sigRef, sig)
  add(widgetRef, widget)
  if (ap) add(ap, ctx.lookup(ap)!)
  // Objects the appearance made (its font).
  if (ap) {
    const res = (ctx.lookup(ap) as PDFRawStream).dict.lookupMaybe(N('Resources'), PDFDict)?.lookupMaybe(N('Font'), PDFDict)
    const fontRef = res?.get(N('Helv'))
    if (fontRef instanceof PDFRef) add(fontRef, ctx.lookup(fontRef)!)
  }

  const size1 = ctx.largestObjectNumber + 1
  const sorted = [...entries].sort((a, b) => a.num - b.num)
  const trailerExtras: string[] = []
  const info = ctx.trailerInfo.Info
  if (info) trailerExtras.push(`/Info ${info.toString()}`)
  const id = ctx.trailerInfo.ID
  if (id) trailerExtras.push(`/ID ${id.toString()}`)

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
    table += `trailer\n<< /Size ${size1} /Root ${root.toString()} ${trailerExtras.join(' ')} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`
    parts.push(latin1(table))
  } else {
    // A cross-reference stream, like the file's own: type 1 entries (offset, generation) for each object we wrote.
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
    const data = Uint8Array.from(rows)
    const head = latin1(`${xrefRef.objectNumber} 0 obj\n<< /Type /XRef /Size ${ctx.largestObjectNumber + 1} /W [1 4 2] /Index [${index.join(' ')}] /Root ${root.toString()} ${trailerExtras.join(' ')} /Prev ${prev} /Length ${data.length} >>\nstream\n`)
    const tail = latin1(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`)
    parts.push(head, data, tail)
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

  // Find the slot inside the signature object and fix the byte range around it.
  const text = new TextDecoder('latin1').decode(out.subarray(sigAt, sigAt + (out.length - sigAt)))
  const cAt = sigAt + text.indexOf('/Contents <') + '/Contents '.length
  const cEnd = cAt + 2 * size + 2
  if (out[cAt] !== 0x3c || out[cEnd - 1] !== 0x3e) throw new Error('Could not place the signature.')
  const range = [0, cAt, cEnd, out.length - cEnd]
  // The three placeholders are ten digits each, so the numbers can be written over them without moving anything.
  ;(['1111111111', '2222222222', '3333333333'] as const).forEach((ph, i) => {
    const at = text.indexOf(ph)
    if (at < 0 || at > text.indexOf('/Contents')) throw new Error('Could not place the signature.')
    out.set(latin1(pad10(range[i + 1])), sigAt + at)
  })

  const toSign = new Uint8Array(range[1] + range[3])
  toSign.set(out.subarray(0, range[1]), 0)
  toSign.set(out.subarray(range[2]), range[1])

  return {
    bytes: out,
    toSign,
    fieldName,
    finish(cms: Uint8Array): Uint8Array {
      if (cms.length > size) throw new Error('The signature is larger than the space reserved for it.')
      const done = out.slice()
      const hex = Array.from(cms, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().padEnd(size * 2, '0')
      done.set(latin1(hex), cAt + 1)
      return done
    }
  }
}

// ---- Reading and checking --------------------------------------------------------------------------

export interface SignatureInfo {
  fieldName: string
  /** Byte ranges as written in the file. */
  byteRange: [number, number, number, number]
  /** The CMS blob (padding removed by the parser). */
  cms: Uint8Array
  name?: string
  reason?: string
  location?: string
  contact?: string
  /** The /M date. */
  signedAt?: string
  /** Certifying signature: the DocMDP level. */
  certify?: CertifyLevel
}

const textOf = (o: PDFObject | undefined): string | undefined => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined)

/** The signature fields that hold a signature, in form order. */
export async function readSignatures(bytes: Uint8Array): Promise<SignatureInfo[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const out: SignatureInfo[] = []
  const perms = doc.catalog.lookupMaybe(N('Perms'), PDFDict)
  const certified = perms?.get(N('DocMDP'))
  const seen = new Set<PDFDict>()
  const walk = (arr: PDFArray | undefined) => {
    if (!arr) return
    for (let i = 0; i < arr.size(); i++) {
      const f = arr.lookupMaybe(i, PDFDict)
      if (!f || seen.has(f)) continue
      seen.add(f)
      walk(f.lookupMaybe(N('Kids'), PDFArray))
      if (f.lookup(N('FT')) !== N('Sig')) continue
      const v = f.lookupMaybe(N('V'), PDFDict)
      const br = v?.lookupMaybe(N('ByteRange'), PDFArray)
      const c = v?.lookup(N('Contents'))
      if (!v || !br || br.size() !== 4 || !(c instanceof PDFHexString)) continue
      const range = [0, 1, 2, 3].map((k) => br.lookupMaybe(k, PDFNumber)?.asNumber() ?? 0) as [number, number, number, number]
      let level: CertifyLevel | undefined
      if (certified !== undefined && arr.get(i) !== undefined && f.get(N('V')) === certified) {
        const ref = v.lookupMaybe(N('Reference'), PDFArray)?.lookupMaybe(0, PDFDict)
        const p = ref?.lookupMaybe(N('TransformParams'), PDFDict)?.lookupMaybe(N('P'), PDFNumber)?.asNumber()
        level = p === 1 || p === 2 || p === 3 ? p : 2
      }
      out.push({
        fieldName: textOf(f.lookup(N('T'))) ?? '',
        byteRange: range,
        cms: c.asBytes(),
        name: textOf(v.lookup(N('Name'))),
        reason: textOf(v.lookup(N('Reason'))),
        location: textOf(v.lookup(N('Location'))),
        contact: textOf(v.lookup(N('ContactInfo'))),
        signedAt: textOf(v.lookup(N('M'))),
        certify: level
      })
    }
  }
  walk(doc.catalog.lookupMaybe(N('AcroForm'), PDFDict)?.lookupMaybe(N('Fields'), PDFArray))
  return out
}

export interface SignatureCheck {
  /** The signed bytes still hash to what the signature says. */
  intact: boolean
  /** The signature itself checks out against the signer's certificate. */
  signatureValid: boolean
  /** The signature covers everything up to the end of the file (nothing was added after). */
  coversWholeFile: boolean
  signer?: { commonName?: string; organisation?: string; issuer?: string; notBefore?: Date; notAfter?: Date; serial?: string }
  /** From the signature's signing-time attribute, when it has one. */
  signingTime?: Date
  /** Hash algorithm name. */
  hash?: string
  /** DER of the certificates in the signature, signer's first (for a chain check in the main process). */
  certificates: Uint8Array[]
  /** A time-stamp token is attached. */
  timestamped: boolean
  /** The time-stamp's time and whether it holds: its own signature checks out and it stamps this signature. */
  timestamp?: { time: Date; valid: boolean; authority?: string }
  /** What went wrong, when something did. */
  problem?: string
}

const HASHES: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512'
}

const OID_NAME: Record<string, 'commonName' | 'organisation'> = { '2.5.4.3': 'commonName', '2.5.4.10': 'organisation' }

function nameParts(n: pkijs.RelativeDistinguishedNames): { commonName?: string; organisation?: string } {
  const out: { commonName?: string; organisation?: string } = {}
  for (const t of n.typesAndValues) {
    const k = OID_NAME[t.type]
    if (k) out[k] = String((t.value as { valueBlock: { value: string } }).valueBlock.value)
  }
  return out
}

function ensureCrypto(): void {
  if (!pkijs.getCrypto()) pkijs.setEngine('webcrypto', new pkijs.CryptoEngine({ name: 'webcrypto', crypto: globalThis.crypto }))
}

const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

/** Checks one signature of a file: that the covered bytes are unchanged and the signature matches its certificate. */
export async function verifySignature(bytes: Uint8Array, sig: SignatureInfo): Promise<SignatureCheck> {
  ensureCrypto()
  const [a, b, c, d] = sig.byteRange
  const base: SignatureCheck = { intact: false, signatureValid: false, coversWholeFile: c + d === bytes.length, certificates: [], timestamped: false }
  if (a !== 0 || b < 0 || c < b || c + d > bytes.length) return { ...base, problem: 'The document was changed after it was signed: the signed part is no longer in the file.' }
  const data = new Uint8Array(b + d)
  data.set(bytes.subarray(0, b), 0)
  data.set(bytes.subarray(c, c + d), b)
  try {
    const parsed = asn1js.fromBER(buf(sig.cms))
    if (parsed.offset === -1) return { ...base, problem: 'The signature data could not be read.' }
    const ci = new pkijs.ContentInfo({ schema: parsed.result })
    const sd = new pkijs.SignedData({ schema: ci.content })
    const si = sd.signerInfos[0]
    const certs = (sd.certificates ?? []).filter((x): x is pkijs.Certificate => x instanceof pkijs.Certificate)
    const signer = si && si.sid instanceof pkijs.IssuerAndSerialNumber ? certs.find((x) => x.issuer.isEqual(si.sid.issuer) && x.serialNumber.isEqual(si.sid.serialNumber)) : certs[0]
    const hashName = HASHES[si?.digestAlgorithm.algorithmId ?? ''] ?? 'SHA-256'
    const info: SignatureCheck = { ...base, hash: hashName, certificates: [] }
    if (signer) {
      const ordered = [signer, ...certs.filter((x) => x !== signer)]
      info.certificates = ordered.map((x) => new Uint8Array(x.toSchema().toBER(false)))
      info.signer = {
        ...nameParts(signer.subject),
        issuer: nameParts(signer.issuer).commonName ?? nameParts(signer.issuer).organisation,
        notBefore: signer.notBefore.value,
        notAfter: signer.notAfter.value,
        serial: signer.serialNumber.valueBlock.toString()
      }
    }
    const attrs = si?.signedAttrs?.attributes ?? []
    const time = attrs.find((x) => x.type === '1.2.840.113549.1.9.5')
    if (time) {
      const v = time.values[0] as asn1js.UTCTime | asn1js.GeneralizedTime
      if ('toDate' in v) info.signingTime = (v as asn1js.UTCTime).toDate()
    }
    const tsAttr = si?.unsignedAttrs?.attributes.find((x) => x.type === '1.2.840.113549.1.9.16.2.14')
    info.timestamped = !!tsAttr
    if (tsAttr && si) info.timestamp = await checkTimestamp(tsAttr.values[0], si.signature.valueBlock.valueHexView)
    // The digest the signature carries against the digest of the bytes it covers.
    const md = attrs.find((x) => x.type === '1.2.840.113549.1.9.4')
    const carried = md ? new Uint8Array((md.values[0] as asn1js.OctetString).valueBlock.valueHexView) : undefined
    const actual = new Uint8Array(await globalThis.crypto.subtle.digest(hashName, buf(data)))
    info.intact = carried ? carried.length === actual.length && carried.every((v, i) => v === actual[i]) : true
    try {
      const res = await sd.verify({ signer: 0, data: buf(data), checkChain: false, extendedMode: true })
      info.signatureValid = res.signatureVerified === true
    } catch {
      // pkijs throws when the digest does not match; that is already reported as "not intact".
      info.signatureValid = false
    }
    if (!info.intact) info.problem = 'The document was changed after it was signed.'
    else if (!info.signatureValid) info.problem = 'The signature does not match its certificate.'
    return info
  } catch (e) {
    return { ...base, problem: `The signature could not be checked: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---- What to tell the person ----------------------------------------------------------------------

export interface ChainInfo {
  trusted: boolean
  status: string[]
  root?: string
}

export type SignatureLevel = 'ok' | 'warn' | 'bad'

const CHAIN_WORDS: Record<string, string> = {
  UntrustedRoot: 'it was issued by an authority this computer does not trust (a self-signed certificate, for example)',
  PartialChain: 'the chain of certificates up to a trusted authority is incomplete',
  NotTimeValid: 'the certificate is outside its validity dates',
  Revoked: 'the certificate has been revoked',
  NotSignatureValid: 'a certificate in the chain has an invalid signature',
  NoCertificate: 'the signature carries no certificate'
}

/** One line for a signature's state, with how serious it is. `laterSignature`: another signature was added after this one. */
export function describeSignature(check: SignatureCheck, chain: ChainInfo | undefined, laterSignature: boolean): { level: SignatureLevel; text: string } {
  if (check.problem && !check.intact) return { level: 'bad', text: check.problem }
  if (!check.signatureValid) return { level: 'bad', text: check.problem ?? 'The signature does not match its certificate.' }
  if (chain && !chain.trusted) {
    const reasons = chain.status.map((x) => CHAIN_WORDS[x] ?? x)
    return { level: 'warn', text: `The signature is intact, but the signer cannot be trusted: ${reasons.join('; ') || 'the certificate could not be checked'}.` }
  }
  const t = check.signingTime
  const s = check.signer
  if (t && s?.notBefore && s.notAfter && (t < s.notBefore || t > s.notAfter)) return { level: 'warn', text: 'The signature is intact, but it was made outside the certificate\u2019s validity dates.' }
  if (!check.coversWholeFile) return laterSignature ? { level: 'ok', text: 'The signature is valid. Later signatures were added after it.' } : { level: 'warn', text: 'The signed part is intact, but the document was changed after it was signed.' }
  return { level: 'ok', text: 'The signature is valid and the document has not been changed since.' }
}


// ---- Time-stamps (RFC 3161) ----------------------------------------------------------------------

const OID_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14'

function signerOf(cms: Uint8Array): { ci: pkijs.ContentInfo; sd: pkijs.SignedData; si: pkijs.SignerInfo } {
  const parsed = asn1js.fromBER(buf(cms))
  if (parsed.offset === -1) throw new Error('The signature data could not be read.')
  const ci = new pkijs.ContentInfo({ schema: parsed.result })
  const sd = new pkijs.SignedData({ schema: ci.content })
  const si = sd.signerInfos[0]
  if (!si) throw new Error('The signature has no signer.')
  return { ci, sd, si }
}

/** A time-stamp request (DER) for a CMS signature: the SHA-256 of its signature value, asking for the TSA's certificates. */
export async function buildTimestampRequest(cms: Uint8Array): Promise<Uint8Array> {
  ensureCrypto()
  const { si } = signerOf(cms)
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: await pkijs.MessageImprint.create('SHA-256', buf(new Uint8Array(si.signature.valueBlock.valueHexView))),
    certReq: true,
    nonce: new asn1js.Integer({ valueHex: pkijs.getRandomValues(new Uint8Array(8)).buffer as ArrayBuffer })
  })
  return new Uint8Array(req.toSchema().toBER(false))
}

/** Puts the time-stamp token from a TSA's response into the signature as its unsigned attribute; returns the new CMS. */
export function addTimestamp(cms: Uint8Array, response: Uint8Array): Uint8Array {
  const parsed = asn1js.fromBER(buf(response))
  if (parsed.offset === -1) throw new Error('The time-stamp server sent something that is not a time-stamp.')
  const resp = new pkijs.TimeStampResp({ schema: parsed.result })
  const status = resp.status.status
  if ((status !== 0 && status !== 1) || !resp.timeStampToken) throw new Error('The time-stamp server refused the request.')
  const { sd, si } = signerOf(cms)
  const attr = new pkijs.Attribute({ type: OID_TIMESTAMP_TOKEN, values: [resp.timeStampToken.toSchema()] })
  si.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 1, attributes: [attr] })
  const out = new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: sd.toSchema() })
  return new Uint8Array(out.toSchema().toBER(false))
}

/** Reads a time-stamp token and checks that it stamps `signatureValue` and is itself properly signed. */
async function checkTimestamp(token: asn1js.AsnType, signatureValue: Uint8Array): Promise<{ time: Date; valid: boolean; authority?: string }> {
  try {
    const ci = new pkijs.ContentInfo({ schema: token })
    const sd = new pkijs.SignedData({ schema: ci.content })
    const econtent = sd.encapContentInfo.eContent
    if (!econtent) throw new Error('empty')
    const tst = new pkijs.TSTInfo({ schema: asn1js.fromBER(econtent.valueBlock.valueHexView.slice().buffer as ArrayBuffer).result })
    const imprint = new Uint8Array(tst.messageImprint.hashedMessage.valueBlock.valueHexView)
    const actual = new Uint8Array(await globalThis.crypto.subtle.digest(HASHES[tst.messageImprint.hashAlgorithm.algorithmId] ?? 'SHA-256', buf(signatureValue)))
    const same = imprint.length === actual.length && imprint.every((v, i) => v === actual[i])
    let signed = false
    try {
      // For a time-stamp token pkijs wants the stamped data (here the signature value) and checks it against the token's imprint too.
      signed = (await sd.verify({ signer: 0, data: buf(new Uint8Array(signatureValue)), checkChain: false, extendedMode: true })).signatureVerified === true
    } catch {
      signed = false
    }
    const certs = (sd.certificates ?? []).filter((x): x is pkijs.Certificate => x instanceof pkijs.Certificate)
    const parts = certs[0] ? nameParts(certs[0].subject) : {}
    return { time: tst.genTime, valid: same && signed, authority: parts.commonName ?? parts.organisation }
  } catch {
    return { time: new Date(0), valid: false }
  }
}
