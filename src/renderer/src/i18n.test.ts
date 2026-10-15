import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error: a plain JavaScript script, run by the tests as well as from the command line
import { checkCatalogues, extractKeys } from '../../../scripts/i18n.mjs'
import { addCatalogues, currentLanguage, languages, msg, plural, resolveLanguage, setLanguage, t } from './i18n'

afterEach(() => setLanguage('en-AU'))

describe('t', () => {
  it('returns the English text as it is, and fills placeholders', () => {
    expect(t('Open file')).toBe('Open file')
    expect(t('Saved {n} files to {where}', { n: 3, where: 'C:\\out' })).toBe('Saved 3 files to C:\\out')
    expect(t('Unknown {thing}', { other: 1 })).toBe('Unknown {thing}')
    expect(msg('File')).toBe('File')
  })

  it('uses a catalogue when the language is chosen, and falls back to English for what it lacks', () => {
    setLanguage('fr')
    expect(currentLanguage()).toBe('fr')
    expect(t('File')).toBe('Fichier')
    expect(t('Something nobody translated')).toBe('Something nobody translated')
    setLanguage('en-AU')
    expect(t('File')).toBe('File')
  })

  it('has American spellings in the en-US catalogue', () => {
    setLanguage('en-US')
    expect(t('Organise')).toBe('Organize')
    expect(t('Centre')).toBe('Center')
    expect(t('Open')).toBe('Open')
  })

  it('takes catalogues added at run time, which replace bundled ones', () => {
    addCatalogues({ de: { name: 'Deutsch', messages: { File: 'Datei', Home: 'Start' } }, fr: { name: 'Français (mien)', messages: { File: 'Dossier' } } })
    setLanguage('de')
    expect(t('File')).toBe('Datei')
    setLanguage('fr')
    expect(t('File')).toBe('Dossier')
    expect(languages().map((l) => l.code)).toContain('de')
  })
})

describe('resolveLanguage', () => {
  it('matches exactly, then by language, and otherwise uses Australian English', () => {
    expect(resolveLanguage('fr')).toBe('fr')
    expect(resolveLanguage('fr-CA')).toBe('fr')
    expect(resolveLanguage('system', 'fr-FR')).toBe('fr')
    expect(resolveLanguage('system', 'en-US')).toBe('en-US')
    expect(resolveLanguage('system', 'zz-ZZ')).toBe('en-AU')
    expect(resolveLanguage('en-AU')).toBe('en-AU')
  })
})

describe('plural', () => {
  it('picks the singular for one and the plural otherwise', () => {
    expect(plural(1, { one: '{n} file', other: '{n} files' })).toBe('1 file')
    expect(plural(3, { one: '{n} file', other: '{n} files' })).toBe('3 files')
    expect(plural(0, { one: '{n} file', other: '{n} files' })).toBe('0 files')
  })
})

describe('catalogues', () => {
  it('are consistent with the source: no stale strings, placeholders kept', () => {
    expect(checkCatalogues()).toEqual([])
  })
  it('find the strings the program shows', () => {
    const keys: string[] = extractKeys()
    expect(keys).toContain('Open')
    expect(keys).toContain('Recognise text (OCR)')
    expect(keys.length).toBeGreaterThan(300)
  })
})
