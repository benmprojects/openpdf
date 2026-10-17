import { describe, expect, it } from 'vitest'
import { countDocument, countWords, findMisspellings, spellCandidates, spellContext } from './proofing'

describe('word count', () => {
  it('counts words, apostrophes and hyphens inside a word, and numbers', () => {
    expect(countWords("It's a well-known fact: 40 pipes.")).toBe(6)
    expect(countWords('')).toBe(0)
    expect(countWords('   \r\n  ')).toBe(0)
  })

  it('counts a document by page, and notes pages with no text', () => {
    const c = countDocument(['One two three\r\nfour', '', 'Five six'])
    expect(c.words).toBe(6)
    expect(c.pages).toBe(3)
    expect(c.pagesWithText).toBe(2)
    expect(c.perPage.map((p) => p.words)).toEqual([4, 0, 2])
    expect(c.characters).toBe('One two three four'.length + 'Five six'.length)
    expect(c.charactersNoSpaces).toBe('Onetwothreefour'.length + 'Fivesix'.length)
    expect(c.lines).toBe(3)
  })
})

describe('spell candidates', () => {
  const words = (s: string, o = {}) => spellCandidates(s, o).map((c) => c.word)

  it('leaves out acronyms, identifiers, numbers, addresses and one-letter words', () => {
    expect(words('The RFI for A4 paper, x2 and 3rd, camelCase and iPhone, see www.example.com or me@example.com.au a')).toEqual(['The', 'for', 'paper', 'and', 'and', 'see', 'or'])
  })

  it('can include acronyms', () => {
    expect(words('Use RFI here', { ignoreCaps: false })).toEqual(['Use', 'RFI', 'here'])
  })

  it('keeps apostrophes inside a word and gives the position', () => {
    const [c] = spellCandidates("   don't")
    expect(c).toEqual({ word: "don't", start: 3, end: 8 })
  })
})

describe('findMisspellings', () => {
  const dictionary = new Set(['the', 'pipe', 'is', 'blocked'])
  const check = (words: string[]) => words.filter((w) => !dictionary.has(w.toLowerCase()))

  it('groups the same word across pages, whatever its case, and gives each place', () => {
    const r = findMisspellings(['The pipe is blokced. Blokced again.', 'The blokced pipe wtih the'], (w) => w.filter((x) => /^(blokced|wtih)$/i.test(x)))
    expect(r.map((g) => g.word)).toEqual(['blokced', 'wtih'])
    expect(r[0].occurrences).toEqual([
      { page: 0, start: 12, end: 19 },
      { page: 0, start: 21, end: 28 },
      { page: 1, start: 4, end: 11 }
    ])
  })

  it('asks the checker about each different word once', () => {
    let asked: string[] = []
    findMisspellings(['pipe pipe pipe cat', 'cat'], (w) => ((asked = w), []))
    expect(asked.sort()).toEqual(['cat', 'pipe'])
  })

  it('leaves out ignored words, whatever their case', () => {
    const r = findMisspellings(['Kerb and kerb'], check, {}, new Set(['kerb']))
    expect(r.map((g) => g.word)).toEqual(['and'])
  })

  it('shows some text around an occurrence', () => {
    const s = 'a'.repeat(50) + ' mistke ' + 'b'.repeat(50)
    const c = spellContext(s, { start: 51, end: 57 }, 5)
    expect(c.startsWith('…')).toBe(true)
    expect(c.endsWith('…')).toBe(true)
    expect(c).toContain('mistke')
  })
})
