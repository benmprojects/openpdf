import { describe, expect, it } from 'vitest'
import { chunkText } from './readAloud'

describe('chunkText', () => {
  it('keeps short text whole and collapses whitespace', () => {
    expect(chunkText('Hello   world.\nSecond line.')).toEqual(['Hello world. Second line.'])
  })
  it('splits at sentence ends near the limit', () => {
    const s = 'One two three. '.repeat(10)
    const chunks = chunkText(s, 40)
    expect(chunks.every((c) => c.length <= 40)).toBe(true)
    expect(chunks.join(' ')).toBe(s.trim())
  })
  it('cuts a very long sentence into pieces', () => {
    const long = 'x'.repeat(500)
    expect(chunkText(long, 200).map((c) => c.length)).toEqual([200, 200, 100])
  })
  it('returns nothing for blank text', () => {
    expect(chunkText('   \n ')).toEqual([])
  })
})
