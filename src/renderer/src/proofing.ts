/**
 * Proofing: counting words and characters, and finding the words a spell checker should look at. The checker itself is
 * the application's own dictionary (the one that underlines words in text boxes) and is passed in, so this part has no
 * dependency on the browser engine.
 */

export interface WordCount {
  words: number
  /** Characters, spaces included (line breaks are not counted). */
  characters: number
  charactersNoSpaces: number
  /** Lines of text, counted from line breaks in the extracted text. */
  lines: number
  pages: number
  /** Pages that hold any text (a scanned page has none). */
  pagesWithText: number
  perPage: { words: number; characters: number }[]
}

/** A word is letters, with apostrophes and hyphens inside it; a number counts as a word. */
const WORD = /[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ja', { granularity: 'word' }) : null

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/

/** The number of words in a piece of text. A run of Chinese or Japanese is split into words by the engine's segmenter. */
export function countWords(s: string): number {
  let n = 0
  for (const m of s.matchAll(WORD)) {
    if (segmenter && CJK.test(m[0])) {
      for (const seg of segmenter.segment(m[0])) if (seg.isWordLike) n++
    } else n++
  }
  return n
}

/** PDFium separates lines with CR LF; spaces and line breaks both end a word, and only spaces count as characters. */
function charCounts(s: string): { all: number; noSpaces: number; lines: number } {
  const flat = s.replace(/[\r\n]+/g, ' ')
  const trimmed = s.trim()
  return { all: flat.trim().length, noSpaces: flat.replace(/\s/g, '').length, lines: trimmed ? trimmed.split(/\r\n|\r|\n/).filter((l) => l.trim()).length : 0 }
}

/** Counts across the text of every page (index = page). */
export function countDocument(pageTexts: string[]): WordCount {
  const out: WordCount = { words: 0, characters: 0, charactersNoSpaces: 0, lines: 0, pages: pageTexts.length, pagesWithText: 0, perPage: [] }
  for (const t of pageTexts) {
    const w = countWords(t)
    const c = charCounts(t)
    out.words += w
    out.characters += c.all
    out.charactersNoSpaces += c.noSpaces
    out.lines += c.lines
    if (w > 0) out.pagesWithText++
    out.perPage.push({ words: w, characters: c.all })
  }
  return out
}

// ---- Spelling ---------------------------------------------------------------------------------------------------------------

export interface SpellOccurrence {
  page: number
  /** UTF-16 range in the page's text. */
  start: number
  end: number
}

export interface SpellWord {
  /** As written (the first occurrence). */
  word: string
  occurrences: SpellOccurrence[]
}

export interface SpellOptions {
  /** Skip words in capitals (acronyms such as RFI or NATA). Default true. */
  ignoreCaps?: boolean
  /** Skip words that have a digit next to them (A4, x2, 3rd). Default true. */
  ignoreDigits?: boolean
}

const LETTERS = /\p{L}+(?:['’]\p{L}+)*/gu
const SKIP_SPANS = /\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+|\b[A-Za-z]:\\\S+/g

const isDigit = (c: string | undefined) => !!c && /\p{N}/u.test(c)

/** The words of a page's text that the spell checker should look at, with where each is. */
export function spellCandidates(s: string, opts: SpellOptions = {}): { word: string; start: number; end: number }[] {
  const ignoreCaps = opts.ignoreCaps !== false
  const ignoreDigits = opts.ignoreDigits !== false
  const skip: [number, number][] = []
  for (const m of s.matchAll(SKIP_SPANS)) skip.push([m.index, m.index + m[0].length])
  const out: { word: string; start: number; end: number }[] = []
  for (const m of s.matchAll(LETTERS)) {
    const word = m[0]
    const start = m.index
    const end = start + word.length
    if (word.replace(/['’]/g, '').length < 2) continue
    if (skip.some(([a, b]) => start >= a && end <= b)) continue
    if (ignoreDigits && (isDigit(s[start - 1]) || isDigit(s[end]))) continue
    // A hyphen or slash joined to a number, or an underscore, makes an identifier rather than a word.
    if (s[end] === '_' || s[start - 1] === '_') continue
    const letters = word.replace(/['’]/g, '')
    if (ignoreCaps && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) continue
    // Capitals inside a word (camelCase, iPhone, McDonald) are names and code, not typing mistakes.
    if (/\p{Ll}\p{Lu}/u.test(letters)) continue
    out.push({ word, start, end })
  }
  return out
}

/**
 * The misspelled words of a document, grouped by word. `isMisspelled` receives each different word once (apostrophes
 * straightened) and returns the ones it does not know; `ignored` words (lower case) are left out.
 */
export function findMisspellings(pageTexts: string[], isMisspelled: (words: string[]) => string[], opts: SpellOptions = {}, ignored: ReadonlySet<string> = new Set()): SpellWord[] {
  const perPage = pageTexts.map((t) => spellCandidates(t, opts))
  const norm = (w: string) => w.replace(/’/g, "'")
  const unique = new Set<string>()
  for (const list of perPage) for (const c of list) if (!ignored.has(norm(c.word).toLowerCase())) unique.add(norm(c.word))
  const bad = new Set(isMisspelled([...unique]))
  const groups = new Map<string, SpellWord>()
  perPage.forEach((list, page) => {
    for (const c of list) {
      const key = norm(c.word)
      if (!bad.has(key) || ignored.has(key.toLowerCase())) continue
      const g = groups.get(key.toLowerCase()) ?? { word: c.word, occurrences: [] }
      g.occurrences.push({ page, start: c.start, end: c.end })
      groups.set(key.toLowerCase(), g)
    }
  })
  return [...groups.values()]
}

/** A short piece of the page text around an occurrence, for the list. */
export function spellContext(s: string, o: { start: number; end: number }, radius = 24): string {
  const a = Math.max(0, o.start - radius)
  const b = Math.min(s.length, o.end + radius)
  return `${a > 0 ? '…' : ''}${s.slice(a, b).replace(/\s+/g, ' ').trim()}${b < s.length ? '…' : ''}`
}

/** The text of every page, from the client's cache (each page is read once); stops early when `signal.cancelled` is set. */
export async function readAllText(client: { pageText(page: number): Promise<{ text: string }> }, pageCount: number, onProgress?: (done: number) => void, signal?: { cancelled: boolean }): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < pageCount; i++) {
    if (signal?.cancelled) break
    out.push((await client.pageText(i)).text)
    if (i % 10 === 9) onProgress?.(i + 1)
  }
  onProgress?.(out.length)
  return out
}
