import { describe, expect, it } from 'vitest'
import {
  QUICK_ACCESS_MAX,
  appFor,
  cleanFloatPane,
  cleanIdentity,
  cleanLaunchApps,
  cleanPerformance,
  cleanPresentation,
  cleanQuickAccess,
  cleanRibbonLayout,
  cleanSearchProviders,
  cleanViewDefaults,
  defaultSearchProviders,
  groupKey,
  initialsOf,
  moveItem,
  parseExtensions,
  searchUrl,
  toggleQuickAccess,
  validExePath,
  validProviderUrl,
  visibleTabs
} from './prefs'

describe('page display defaults', () => {
  it('fills what is missing and ignores what is odd', () => {
    expect(cleanViewDefaults(undefined)).toEqual({ twoUp: false, continuous: true, cover: false, rtl: false, gaps: true, thinLines: false, zoom: 'fit-width' })
    expect(cleanViewDefaults({ twoUp: true, rtl: 'yes', zoom: 'actual', gaps: false })).toMatchObject({ twoUp: true, rtl: false, zoom: 'actual', gaps: false })
    expect(cleanViewDefaults({ zoom: 'huge' }).zoom).toBe('fit-width')
  })
})

describe('search providers', () => {
  it('accepts https addresses with {q} only', () => {
    expect(validProviderUrl('https://example.com/?q={q}')).toBe(true)
    expect(validProviderUrl('https://example.com/')).toBe(false)
    expect(validProviderUrl('http://example.com/?q={q}')).toBe(false)
    expect(validProviderUrl('javascript:alert({q})')).toBe(false)
    expect(validProviderUrl('file:///c:/x?{q}')).toBe(false)
    expect(validProviderUrl('https://user:pw@example.com/?q={q}')).toBe(false)
  })
  it('cleans a list, dropping bad and repeated entries', () => {
    const out = cleanSearchProviders([
      { id: 'a', name: 'A', url: 'https://a.example/?q={q}' },
      { id: 'a', name: 'Again', url: 'https://a.example/?q={q}' },
      { id: 'b', name: 'B', url: 'ftp://b.example/{q}' },
      { id: 'c', name: '', url: 'https://c.example/{q}' },
      'nonsense'
    ])
    expect(out.map((p) => p.id)).toEqual(['a'])
  })
  it('keeps the fallback when the setting is not a list', () => {
    expect(cleanSearchProviders(undefined, defaultSearchProviders())).toHaveLength(2)
    expect(cleanSearchProviders([], defaultSearchProviders())).toEqual([])
  })
  it('builds the address with the text escaped and collapsed', () => {
    expect(searchUrl({ id: 'x', name: 'X', url: 'https://x.example/?q={q}' }, '  steel   grade & mesh\n')).toBe('https://x.example/?q=steel%20grade%20%26%20mesh')
  })
})

describe('identity', () => {
  it('trims and limits the text', () => {
    expect(cleanIdentity({ initials: ' TU ', email: 'a@example.com\n', organisation: 'x'.repeat(500), title: 5 })).toEqual({ initials: 'TU', email: 'a@example.com', organisation: 'x'.repeat(120), title: '' })
  })
  it('makes initials from a name', () => {
    expect(initialsOf('test user')).toBe('TU')
    expect(initialsOf('')).toBe('')
  })
})

describe('launch applications', () => {
  it('needs a full .exe path on a drive', () => {
    expect(validExePath('C:\\Program Files\\Example\\app.exe')).toBe(true)
    expect(validExePath('app.exe')).toBe(false)
    expect(validExePath('C:\\tools\\run.bat')).toBe(false)
    expect(validExePath('C:\\a\\..\\b.exe')).toBe(false)
    expect(validExePath('\\\\server\\share\\app.exe')).toBe(false)
  })
  it('reads file types', () => {
    expect(parseExtensions('.DOCX, xlsx;  docx  tar.gz')).toEqual(['docx', 'xlsx'])
  })
  it('cleans the list and finds a program by extension', () => {
    const apps = cleanLaunchApps([
      { id: 'sheet', name: 'Sheets', extensions: ['xlsx', 'CSV'], path: 'C:\\x\\sheet.exe' },
      { id: 'bad', name: 'Bad', extensions: ['txt'], path: 'cmd' },
      { id: 'sheet', name: 'Twice', extensions: ['txt'], path: 'C:\\x\\t.exe' }
    ])
    expect(apps).toHaveLength(1)
    expect(appFor(apps, 'Budget.XLSX')?.id).toBe('sheet')
    expect(appFor(apps, 'notes.txt')).toBeNull()
    expect(appFor(apps, 'noextension')).toBeNull()
  })
})

describe('performance', () => {
  it('clamps to sensible limits', () => {
    expect(cleanPerformance({ tileMegapixels: 1, renderAhead: 99999, renderJobs: 9 })).toEqual({ tileMegapixels: 4, renderAhead: 2400, renderJobs: 4 })
    expect(cleanPerformance(null)).toEqual({ tileMegapixels: 16, renderAhead: 600, renderJobs: 2 })
  })
})

describe('quick access', () => {
  it('keeps valid ids once each, up to the maximum', () => {
    expect(cleanQuickAccess(['open', 'open', 'Bad Id', 5, 'save'])).toEqual(['open', 'save'])
    expect(cleanQuickAccess(Array.from({ length: 40 }, (_, i) => `c${i}`))).toHaveLength(QUICK_ACCESS_MAX)
    expect(cleanQuickAccess('x')).toEqual(['open', 'save', 'print', 'undo', 'redo'])
  })
  it('toggles and moves', () => {
    expect(toggleQuickAccess(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleQuickAccess(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleQuickAccess(Array.from({ length: QUICK_ACCESS_MAX }, (_, i) => `c${i}`), 'new')).toHaveLength(QUICK_ACCESS_MAX)
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
  })
})

describe('ribbon layout', () => {
  it('cleans ids and group keys', () => {
    const l = cleanRibbonLayout({ tabOrder: ['view', 'home', 'view', 'Bad'], hiddenTabs: ['forms'], hiddenGroups: ['view/Zoom', 'nonsense', 'x/\nbad'] })
    expect(l).toEqual({ tabOrder: ['view', 'home'], hiddenTabs: ['forms'], hiddenGroups: ['view/Zoom'] })
  })
  const all = [{ id: 'file' }, { id: 'home' }, { id: 'edit' }, { id: 'view' }]
  it('orders and hides tabs but always keeps File', () => {
    expect(visibleTabs(all, { tabOrder: ['view'], hiddenTabs: ['edit'], hiddenGroups: [] }).map((t) => t.id)).toEqual(['view', 'file', 'home'])
    expect(visibleTabs(all, { tabOrder: [], hiddenTabs: ['file', 'home'], hiddenGroups: [] }).map((t) => t.id)).toEqual(['file', 'edit', 'view'])
  })
  it('builds group keys', () => {
    expect(groupKey('view', 'Zoom')).toBe('view/Zoom')
  })
})

describe('presentation and floating pane', () => {
  it('cleans the presentation choices', () => {
    expect(cleanPresentation({ transition: 'fade', seconds: 5, loop: true })).toEqual({ transition: 'fade', seconds: 5, loop: true })
    expect(cleanPresentation({ transition: 'spin', seconds: -3, loop: 'x' })).toEqual({ transition: 'none', seconds: 0, loop: false })
  })
  it('keeps the floating pane inside sane bounds', () => {
    expect(cleanFloatPane({ floating: true, x: -5, y: 99999, w: 10, h: 99999 })).toEqual({ floating: true, x: 0, y: 3000, w: 200, h: 1200 })
  })
})
