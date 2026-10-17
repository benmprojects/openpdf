/**
 * Saved settings for the page-mark dialogs (header and footer, page numbers, Bates numbers, watermark, crop). A preset is a
 * named bag of plain values; the dialog decides what each value means. Kept in Settings, so cleaned on the way in.
 * Pictures are never part of a preset.
 */

export const MARK_PRESET_KINDS = ['headerfooter', 'pagenumbers', 'bates', 'watermark', 'crop'] as const
export type MarkPresetKind = (typeof MARK_PRESET_KINDS)[number]

export type PresetScalar = string | number | boolean
export type PresetValue = PresetScalar | { [key: string]: PresetScalar }

export interface MarkPreset {
  id: string
  name: string
  kind: MarkPresetKind
  values: Record<string, PresetValue>
}

const MAX_PRESETS = 100
const MAX_VALUES = 60
const MAX_TEXT = 500

const scalar = (v: unknown): PresetScalar | undefined => {
  if (typeof v === 'string') return v.slice(0, MAX_TEXT)
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v
  return undefined
}

/** Valid presets only: known kind, a name, and values that are plain text, numbers, yes/no or one level of those. */
export function cleanMarkPresets(raw: unknown): MarkPreset[] {
  if (!Array.isArray(raw)) return []
  const out: MarkPreset[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) continue
    if (!(MARK_PRESET_KINDS as readonly string[]).includes(r.kind as string)) continue
    const values: Record<string, PresetValue> = {}
    if (r.values && typeof r.values === 'object') {
      for (const [k, v] of Object.entries(r.values as Record<string, unknown>).slice(0, MAX_VALUES)) {
        if (!/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(k)) continue
        const s = scalar(v)
        if (s !== undefined) values[k] = s
        else if (v && typeof v === 'object' && !Array.isArray(v)) {
          const inner: Record<string, PresetScalar> = {}
          for (const [ik, iv] of Object.entries(v as Record<string, unknown>).slice(0, 12)) {
            const si = scalar(iv)
            if (/^[A-Za-z0-9]{1,12}$/.test(ik) && si !== undefined) inner[ik] = si
          }
          values[k] = inner
        }
      }
    }
    out.push({ id: r.id.slice(0, 64), name: r.name.trim().slice(0, 80), kind: r.kind as MarkPresetKind, values })
    if (out.length >= MAX_PRESETS) break
  }
  return out
}

/** The list with `preset` saved: one of the same kind and name is replaced. */
export function savePreset(list: MarkPreset[], preset: MarkPreset): MarkPreset[] {
  const same = (p: MarkPreset) => p.kind === preset.kind && p.name.toLowerCase() === preset.name.toLowerCase()
  return [...list.filter((p) => !same(p) && p.id !== preset.id), preset]
}

/** Number: the stored value when it is a finite number, else `fallback`. */
export const presetNumber = (v: PresetValue | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
export const presetText = (v: PresetValue | undefined, fallback: string): string => (typeof v === 'string' ? v : fallback)
export const presetFlag = (v: PresetValue | undefined, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
export const presetMap = (v: PresetValue | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x
  return out
}
