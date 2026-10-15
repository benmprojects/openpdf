/**
 * qpdf (Apache-2.0) compiled to WebAssembly (@neslinesli93/qpdf-wasm, ISC), for what pdf-lib cannot do: rewriting
 * the file with object streams and recompressed streams, dropping unreferenced objects and resources, and
 * linearising ("fast web view"). Each run gets a fresh module so no state carries between files.
 */
import createModule from '@neslinesli93/qpdf-wasm'
import { encryptArgs, parseEncryptionJson, type EncryptionInfo, type EncryptOptions } from '../shared/pdfSecurity'

export interface QpdfOptions {
  /** Pack objects into compressed object streams (PDF 1.5). */
  objectStreams: boolean
  /** Decompress and recompress Flate streams at the highest level. */
  recompress: boolean
  /** Drop fonts, images and other resources that pages list but never use. */
  removeUnusedResources: boolean
  /** Linearise for fast web view. */
  linearise: boolean
}

export function qpdfArgs(o: QpdfOptions): string[] {
  const args = ['--compress-streams=y', '--decode-level=generalized']
  args.push(o.objectStreams ? '--object-streams=generate' : '--object-streams=preserve')
  if (o.recompress) args.push('--recompress-flate', '--compression-level=9')
  args.push(`--remove-unreferenced-resources=${o.removeUnusedResources ? 'yes' : 'no'}`)
  if (o.linearise) args.push('--linearize')
  return args
}

/** Rewrites a PDF through qpdf. Unreachable objects are always dropped (qpdf writes only what the file uses). */
export async function runQpdf(input: Uint8Array, o: QpdfOptions): Promise<Uint8Array> {
  const messages: string[] = []
  const q = await createModule({
    locateFile: () => require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'),
    noInitialRun: true,
    print: (s: string) => messages.push(s),
    printErr: (s: string) => messages.push(s)
  } as never)
  const fs = q.FS as unknown as { writeFile: (p: string, d: Uint8Array) => void; readFile: (p: string) => Uint8Array }
  fs.writeFile('/in.pdf', input)
  // Exit status 3 means it worked with warnings (for example a damaged xref it repaired).
  const rc = q.callMain([...qpdfArgs(o), '/in.pdf', '/out.pdf'])
  if (rc !== 0 && rc !== 3) throw new Error(messages.slice(-3).join(' ') || `qpdf failed (${rc})`)
  return fs.readFile('/out.pdf')
}

interface QpdfRun {
  rc: number
  out: string[]
  data?: Uint8Array
}

/** Runs qpdf with the given files in its in-memory file system; reads `/out.pdf` back when it exists. */
async function qpdf(args: string[], files: Record<string, Uint8Array>, read = '/out.pdf'): Promise<QpdfRun> {
  const out: string[] = []
  const q = await createModule({
    locateFile: () => require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'),
    noInitialRun: true,
    print: (s: string) => out.push(s),
    printErr: (s: string) => out.push(s)
  } as never)
  const fs = q.FS as unknown as { writeFile: (p: string, d: Uint8Array) => void; readFile: (p: string) => Uint8Array }
  for (const [name, data] of Object.entries(files)) fs.writeFile(name, data)
  const rc = q.callMain(args)
  let data: Uint8Array | undefined
  try {
    data = fs.readFile(read)
  } catch {
    data = undefined
  }
  return { rc, out, data }
}

const failure = (r: QpdfRun) => new Error(r.out.filter((l) => !/^\s*$/.test(l)).slice(-2).join(' ') || `qpdf failed (${r.rc})`)

/** Whether a file is encrypted, whether a password is needed, and what the permissions are. `password` may be the user or owner password. */
export async function encryptionInfo(data: Uint8Array, password = ''): Promise<EncryptionInfo> {
  // The JSON goes to a file: qpdf's printed output does not reach us reliably inside Electron.
  const r = await qpdf(['--json=latest', '--json-key=encrypt', `--password=${password}`, '/in.pdf', '/out.json'], { '/in.pdf': data }, '/out.json')
  return parseEncryptionJson(r.data ? new TextDecoder().decode(r.data) : undefined, r.rc)
}

/** The file with its encryption removed. Throws "invalid password" for a wrong password. */
export async function decryptPdf(data: Uint8Array, password: string): Promise<Uint8Array> {
  const r = await qpdf(['--decrypt', `--password=${password}`, '/in.pdf', '/out.pdf'], { '/in.pdf': data })
  if ((r.rc !== 0 && r.rc !== 3) || !r.data) throw failure(r)
  return r.data
}

/** The file encrypted with new passwords and permissions. */
export async function encryptPdf(data: Uint8Array, o: EncryptOptions): Promise<Uint8Array> {
  const r = await qpdf([...encryptArgs(o), '/in.pdf', '/out.pdf'], { '/in.pdf': data })
  if ((r.rc !== 0 && r.rc !== 3) || !r.data) throw failure(r)
  return r.data
}

/** `plain` encrypted the way `original` was (same passwords, key and permissions); `password` opens `original`. */
export async function copyEncryption(plain: Uint8Array, original: Uint8Array, password: string): Promise<Uint8Array> {
  const r = await qpdf(['--copy-encryption=/original.pdf', `--encryption-file-password=${password}`, '/in.pdf', '/out.pdf'], { '/in.pdf': plain, '/original.pdf': original })
  if ((r.rc !== 0 && r.rc !== 3) || !r.data) throw failure(r)
  return r.data
}
