/**
 * Find and replace in the text of page content, across the whole document (or chosen pages). The text is read through
 * each font's own code table, replaced, and written back with the same font, so the look of the text does not change
 * except that a longer or shorter replacement moves what follows it on the same line. Characters the font does not have
 * (a subset font only holds the characters the file already uses) are not written: that occurrence is skipped and
 * counted. Text split into pieces by the file (letters placed one at a time) is not found.
 */
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { hexString, num, parseContent, type Op, type Tok } from './content'
import { contentScopes } from './docStreams'
import { openFont, type FontCodec } from './embeddedFont'

export interface FindOptions {
  find: string
  replace: string
  matchCase: boolean
  wholeWord: boolean
  /** Zero-based pages to work on; all when omitted. Text in forms is changed only when the page that draws them is chosen (or all pages). */
  pages?: number[]
}

export interface FindResult {
  bytes: Uint8Array
  replaced: number
  /** Occurrences left alone, with the reason. */
  skipped: { reason: string; count: number }[]
  /** Pages (zero-based) with a change on the page itself. */
  pages: number[]
  /** Lines written as one string because the match was split across pieces (spacing between letters is lost). */
  joined: number
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The search as a regular expression over the decoded text. */
export function searchPattern(o: Pick<FindOptions, 'find' | 'matchCase' | 'wholeWord'>): RegExp {
  const body = escapeRe(o.find)
  const word = o.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body
  return new RegExp(word, `g${o.matchCase ? '' : 'i'}u`)
}

function serialiseTok(t: Tok): string {
  if (t.t === 'num') return num(t.v)
  if (t.t === 'str') return hexString(t.v)
  if (t.t === 'name') return `/${t.v}`
  if (t.t === 'arr') return `[${t.v.map(serialiseTok).join(' ')}]`
  if (t.t === 'dict') return `<<${t.v.map(serialiseTok).join(' ')}>>`
  return t.v
}

/** Replaces matches in one string of codes; returns the new codes, how many were replaced, and how many were skipped for missing glyphs. */
export function replaceInCodes(codes: string, codec: FontCodec, re: RegExp, replacement: string): { codes: string; done: number; missing: number } {
  const w = codec.info.composite ? 2 : 1
  const n = Math.floor(codes.length / w)
  // Text of each code, and where each starts in the joined text, so a match can be mapped back to codes.
  const at = new Map<number, number>()
  let text = ''
  for (let i = 0; i < n; i++) {
    at.set(text.length, i)
    text += codec.decode(codes.slice(i * w, (i + 1) * w))
  }
  at.set(text.length, n)
  re.lastIndex = 0
  let out = ''
  let from = 0
  let done = 0
  let missing = 0
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue
    const a = at.get(m.index!)
    const b = at.get(m.index! + m[0].length)
    if (a === undefined || b === undefined || a < from) continue
    const enc = codec.encode(replacement, text)
    if (enc.missing.length) {
      missing++
      continue
    }
    out += codes.slice(from * w, a * w) + enc.bytes
    from = b
    done++
  }
  if (!done) return { codes, done: 0, missing }
  return { codes: out + codes.slice(from * w), done, missing }
}

/** Finds and replaces text. Returns the new file and what was done. */
export async function findReplaceText(bytes: Uint8Array, o: FindOptions): Promise<FindResult> {
  if (!o.find) return { bytes, replaced: 0, skipped: [], pages: [], joined: 0 }
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const re = searchPattern(o)
  const skipped = new Map<string, number>()
  const skip = (reason: string, n = 1) => skipped.set(reason, (skipped.get(reason) ?? 0) + n)
  let replaced = 0
  let joined = 0
  const pagesChanged = new Set<number>()
  const wanted = o.pages ? new Set(o.pages) : null
  for (const scope of contentScopes(doc)) {
    if (wanted && scope.kind === 'page' && !wanted.has(scope.page!)) continue
    if (wanted && scope.kind !== 'page' && wanted.size === 0) continue
    const src = scope.get()
    if (!src) continue
    const fonts = scope.resources?.lookupMaybe(PDFName.of('Font'), PDFDict)
    const codecs = new Map<string, FontCodec | string>()
    const codecFor = (name: string): FontCodec | string => {
      let c = codecs.get(name)
      if (c === undefined) {
        const opened = openFont(fonts, name)
        c = 'codec' in opened ? opened.codec : opened.problem
        codecs.set(name, c)
      }
      return c
    }
    const ops = parseContent(src)
    let font = ''
    const stack: string[] = []
    const edits: { op: Op; text: string }[] = []
    for (const op of ops) {
      if (op.op === 'q') stack.push(font)
      else if (op.op === 'Q') font = stack.pop() ?? font
      else if (op.op === 'Tf' && op.operands[0]?.t === 'name') font = op.operands[0].v
      else if (op.op === 'Tj' || op.op === 'TJ' || op.op === "'" || op.op === '"') {
        if (!font) continue
        const strings: Tok[] = op.op === 'TJ' ? (op.operands[0]?.t === 'arr' ? op.operands[0].v : []) : op.operands.slice(-1)
        const codeList = strings.map((t) => (t.t === 'str' ? t.v : ''))
        if (!codeList.some(Boolean)) continue
        const codec = codecFor(font)
        if (typeof codec === 'string') {
          // Only worth mentioning when the text there would have matched; decode with nothing to go on is not possible.
          continue
        }
        let done = 0
        const next = strings.map((t) => {
          if (t.t !== 'str') return t
          const r = replaceInCodes(t.v, codec, re, o.replace)
          done += r.done
          if (r.missing) skip('The font does not have every character of the replacement', r.missing)
          return r.done ? ({ t: 'str', v: r.codes } as Tok) : t
        })
        if (!done && op.op === 'TJ' && strings.length > 1) {
          // A match split across the pieces of a TJ array: write the whole thing as one string (kerning is dropped).
          const all = codeList.join('')
          const r = replaceInCodes(all, codec, re, o.replace)
          if (r.missing) skip('The font does not have every character of the replacement', r.missing)
          if (r.done) {
            edits.push({ op, text: `${hexString(r.codes)} Tj` })
            joined++
            replaced += r.done
            pagesChanged.add(scope.page ?? -1)
          }
          continue
        }
        if (!done) continue
        replaced += done
        if (scope.kind === 'page') pagesChanged.add(scope.page!)
        if (op.op === 'TJ') edits.push({ op, text: `[${next.map(serialiseTok).join(' ')}] TJ` })
        else edits.push({ op, text: `${[...op.operands.slice(0, -1), next[0]].map(serialiseTok).join(' ')} ${op.op}` })
      }
    }
    if (edits.length) {
      let out = ''
      let at = 0
      for (const e of edits) {
        out += src.slice(at, e.op.start) + e.text
        at = e.op.end
      }
      scope.set(out + src.slice(at))
    }
  }
  pagesChanged.delete(-1)
  const list = [...skipped].filter(([, n]) => n > 0).map(([reason, count]) => ({ reason, count }))
  return { bytes: replaced ? await doc.save() : bytes, replaced, skipped: list, pages: [...pagesChanged].sort((a, b) => a - b), joined }
}
