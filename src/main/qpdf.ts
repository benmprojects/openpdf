/**
 * qpdf (Apache-2.0) compiled to WebAssembly (@neslinesli93/qpdf-wasm, ISC), for what pdf-lib cannot do: rewriting
 * the file with object streams and recompressed streams, dropping unreferenced objects and resources, and
 * linearising ("fast web view"). Each run gets a fresh module so no state carries between files.
 */
import createModule from '@neslinesli93/qpdf-wasm'

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
