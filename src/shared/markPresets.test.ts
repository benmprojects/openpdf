import { describe, expect, it } from 'vitest'
import { cleanMarkPresets, presetMap, presetNumber, savePreset, type MarkPreset } from './markPresets'

describe('cleanMarkPresets', () => {
  it('keeps valid presets and drops the rest', () => {
    const out = cleanMarkPresets([
      { id: 'a', name: ' Draft ', kind: 'watermark', values: { text: 'DRAFT', size: 64, tile: true, slots: { tl: 'x', tc: 5, '!!': 'bad' }, evil: [1, 2], 'bad key': 1 } },
      { id: 'b', name: '', kind: 'watermark', values: {} },
      { id: 'c', name: 'Odd', kind: 'unknown', values: {} },
      null,
      { name: 'No id', kind: 'crop' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Draft')
    expect(out[0].values).toEqual({ text: 'DRAFT', size: 64, tile: true, slots: { tl: 'x', tc: 5 } })
  })
  it('limits length and number of values', () => {
    const out = cleanMarkPresets([{ id: 'a', name: 'n', kind: 'crop', values: { t: 'x'.repeat(2000) } }])
    expect((out[0].values.t as string).length).toBe(500)
    expect(cleanMarkPresets('nope')).toEqual([])
  })
})

describe('savePreset and readers', () => {
  const p = (id: string, name: string, kind: MarkPreset['kind'] = 'crop'): MarkPreset => ({ id, name, kind, values: {} })
  it('replaces a preset of the same kind and name', () => {
    expect(savePreset([p('1', 'Book'), p('2', 'Other', 'watermark')], p('3', 'book')).map((x) => x.id)).toEqual(['2', '3'])
  })
  it('reads values with fallbacks', () => {
    expect(presetNumber('x', 5)).toBe(5)
    expect(presetNumber(7, 5)).toBe(7)
    expect(presetMap({ tl: 'a', tc: 1 })).toEqual({ tl: 'a' })
  })
})
