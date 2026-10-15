import { describe, expect, it, vi } from 'vitest'
import { editMenuTemplate, type EditContext } from './spellMenu'

const flags = { canCut: true, canCopy: true, canPaste: false, canSelectAll: true }
const ctx = (over: Partial<EditContext> = {}): EditContext => ({ misspelledWord: '', dictionarySuggestions: [], editFlags: flags, ...over })

describe('editMenuTemplate', () => {
  it('is just the edit commands when nothing is misspelled', () => {
    const t = editMenuTemplate(ctx(), { replace: vi.fn(), addWord: vi.fn() })
    expect(t.map((i) => i.label ?? '-')).toEqual(['Cut', 'Copy', 'Paste', '-', 'Select all'])
    expect(t[2].enabled).toBe(false)
  })

  it('offers up to five suggestions and adding the word, and they act', () => {
    const replace = vi.fn()
    const addWord = vi.fn()
    const t = editMenuTemplate(ctx({ misspelledWord: 'colur', dictionarySuggestions: ['colour', 'color', 'colure', 'col', 'cola', 'colon'] }), { replace, addWord })
    expect(t.slice(0, 5).map((i) => i.label)).toEqual(['colour', 'color', 'colure', 'col', 'cola'])
    expect(t[5].label).toBe('Add to dictionary')
    ;(t[0].click as () => void)()
    ;(t[5].click as () => void)()
    expect(replace).toHaveBeenCalledWith('colour')
    expect(addWord).toHaveBeenCalledWith('colur')
  })

  it('says when there are no suggestions', () => {
    const t = editMenuTemplate(ctx({ misspelledWord: 'zzxq' }), { replace: vi.fn(), addWord: vi.fn() })
    expect(t[0]).toMatchObject({ label: 'No suggestions', enabled: false })
  })
})
