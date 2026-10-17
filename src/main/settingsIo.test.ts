import { describe, expect, it } from 'vitest'
import { exportSettings, parseSettingsImport, PORTABLE_KEYS } from './settingsIo'
import type { Settings } from './settings'

const base = {
  theme: 'dark',
  recent: ['C:\\private\\a.pdf'],
  lastSession: ['C:\\private\\b.pdf'],
  autosaveMinutes: 5,
  author: 'A. Author',
  sidebarWidth: 300,
  paneSide: 'right',
  spellcheck: false,
  restoreSession: true,
  toolDefaults: { line: { color: '#ff0000' } },
  toolPresets: [],
  scalePresets: [],
  markPresets: [],
  securityPolicies: [],
  viewDefaults: { twoUp: false },
  searchProviders: [],
  identity: { initials: 'AA' },
  performance: { renderJobs: 2 },
  quickAccess: ['open'],
  ribbonLayout: { tabOrder: [], hiddenTabs: [], hiddenGroups: [] },
  presentation: { transition: 'none', seconds: 0, loop: false },
  launchApps: [{ id: 'x', name: 'X', extensions: ['txt'], path: 'C:\\private\\x.exe' }],
  updates: { check: true, feed: 'https://updates.example.test/feed.json' },
  language: 'en-AU',
  printer: 'Office printer',
  printPaper: 'A3'
} as unknown as Settings

describe('settings export and import', () => {
  it('writes only the portable settings', () => {
    const text = exportSettings(base)
    const data = JSON.parse(text)
    expect(Object.keys(data.settings).sort()).toEqual([...PORTABLE_KEYS].sort())
    expect(text).not.toContain('private')
    expect(text).not.toContain('Office printer')
    expect(text).not.toContain('updates.example')
  })

  it('reads back what it wrote', () => {
    const r = parseSettingsImport(exportSettings(base))
    expect(r).toMatchObject({ ok: true, skipped: [] })
    if (r.ok) expect(r.patch).toMatchObject({ theme: 'dark', paneSide: 'right', restoreSession: true, printPaper: 'A3', author: 'A. Author' })
  })

  it('skips unknown keys, local ones and values of the wrong kind, and says which', () => {
    const text = JSON.stringify({
      format: 'openpdf-settings',
      version: 1,
      settings: { theme: 'purple', recent: ['x.pdf'], updates: { check: true, feed: 'https://x.example.test' }, spellcheck: true, bogus: 1 }
    })
    const r = parseSettingsImport(text)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.patch).toEqual({ spellcheck: true })
      expect(r.skipped.sort()).toEqual(['bogus', 'recent', 'theme', 'updates'])
    }
  })

  it('refuses other files with a clear message', () => {
    expect(parseSettingsImport('not json')).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') })
    expect(parseSettingsImport('{"theme":"dark"}')).toMatchObject({ ok: false, error: expect.stringContaining('not an OpenPDF settings file') })
    expect(parseSettingsImport('{"format":"openpdf-settings","settings":{"bogus":1}}')).toMatchObject({ ok: false, error: expect.stringContaining('no settings') })
  })

  it('accepts a byte-order mark', () => {
    expect(parseSettingsImport('\uFEFF' + exportSettings(base)).ok).toBe(true)
  })
})
