import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkCatalogue, userCatalogues } from './locales'

describe('checkCatalogue', () => {
  it('accepts a name and string messages, dropping the rest', () => {
    expect(checkCatalogue({ name: 'Deutsch', messages: { File: 'Datei', Bad: 5, Empty: '' } })).toEqual({ name: 'Deutsch', messages: { File: 'Datei' } })
  })
  it('refuses things that are not catalogues', () => {
    expect(checkCatalogue(null)).toBeNull()
    expect(checkCatalogue({ messages: {} })).toBeNull()
    expect(checkCatalogue({ name: '  ', messages: {} })).toBeNull()
    expect(checkCatalogue({ name: 'x', messages: 'no' })).toBeNull()
    expect(checkCatalogue({ name: 'x'.repeat(100), messages: {} })).toBeNull()
  })
  it('skips overlong strings', () => {
    expect(checkCatalogue({ name: 'x', messages: { ok: 'fine', long: 'y'.repeat(700) } })?.messages).toEqual({ ok: 'fine' })
  })
})

describe('userCatalogues', () => {
  it('reads files named by language code and ignores the rest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'openpdf-locales-'))
    try {
      writeFileSync(join(dir, 'de.json'), JSON.stringify({ name: 'Deutsch', messages: { File: 'Datei' } }))
      writeFileSync(join(dir, 'pt-BR.json'), JSON.stringify({ name: 'Português (Brasil)', messages: { File: 'Arquivo' } }))
      writeFileSync(join(dir, 'broken.json'), '{ not json')
      writeFileSync(join(dir, 'not a code.json'), JSON.stringify({ name: 'x', messages: {} }))
      writeFileSync(join(dir, 'notes.txt'), 'hello')
      const out = await userCatalogues(dir)
      expect(Object.keys(out).sort()).toEqual(['de', 'pt-BR'])
      expect(await userCatalogues(join(dir, 'missing'))).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
