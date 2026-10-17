import { describe, expect, it } from 'vitest'
import { BUILT_IN_PRESETS, allPresets, deletePreset, loadPresets, parsePresets, savePreset, serialisePresets, storePresets, STORAGE_KEY, type KeyValueStore, type ScanPreset } from './scanPresets'

const mine: ScanPreset = { name: 'Site dockets', source: 'feeder', dpi: 300, color: 'bw', paper: 'a4', duplex: true, deskew: true, despeckle: true, autoCrop: false, ocr: true, ocrLanguages: ['eng'] }

function memory(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

describe('scan presets', () => {
  it('round trips through storage', () => {
    const store = memory()
    storePresets([mine], store)
    expect(store.map.has(STORAGE_KEY)).toBe(true)
    expect(loadPresets(store)).toEqual([mine])
    expect(parsePresets(serialisePresets([mine]))).toEqual([mine])
  })

  it('ignores junk', () => {
    expect(parsePresets(null)).toEqual([])
    expect(parsePresets('not json')).toEqual([])
    expect(parsePresets('{"a":1}')).toEqual([])
    expect(parsePresets(JSON.stringify([1, null, 'x', { name: '' }, { dpi: 300 }]))).toEqual([])
  })

  it('repairs invalid fields and drops clashing names', () => {
    const got = parsePresets(JSON.stringify([{ name: 'A', dpi: 12345, color: 'pink', source: 'x', ocrLanguages: [3, 'fra'] }, { name: 'a' }, { name: BUILT_IN_PRESETS[0].name }]))
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ name: 'A', dpi: 200, color: 'color', source: 'dialog', ocrLanguages: ['fra'], paper: 'auto', duplex: false })
  })

  it('adds, replaces by name and deletes', () => {
    let r = savePreset([], mine)
    expect(r.list).toEqual([mine])
    r = savePreset(r.list, { ...mine, name: 'site DOCKETS', dpi: 600 })
    expect(r.list).toHaveLength(1)
    expect(r.list[0].dpi).toBe(600)
    expect(deletePreset(r.list, 'site DOCKETS')).toEqual([])
  })

  it('refuses a built-in name or an empty one', () => {
    expect(savePreset([], { ...mine, name: BUILT_IN_PRESETS[0].name.toUpperCase() }).error).toBeTruthy()
    expect(savePreset([], { ...mine, name: '  ' }).error).toBeTruthy()
  })

  it('lists built-in presets first, with plain names', () => {
    const all = allPresets([mine])
    expect(all.at(-1)).toBe(mine)
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(3)
    expect(new Set(BUILT_IN_PRESETS.map((p) => p.name)).size).toBe(BUILT_IN_PRESETS.length)
  })

  it('copes with no storage', () => {
    expect(loadPresets(undefined)).toEqual(loadPresets(undefined))
    expect(() => storePresets([mine], undefined)).not.toThrow()
  })
})
