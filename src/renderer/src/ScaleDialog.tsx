import { useMemo, useState } from 'react'
import { Modal } from './AppDialogs'
import { formatLength, type Scale } from './measure'
import { FRACTIONS, MM_PER_PT, PRESET_RATIOS, UNITS, factorForRatio, isImperial, parseRatio, ratioFromCustom, ratioText, type Precision, type ScalePreset } from './measureScale'
import { t } from './i18n'

export type ScaleScope = 'page' | 'selected' | 'all'

interface Props {
  pageCount: number
  currentPage: number
  /** Pages selected in the thumbnails (zero-based); the "selected pages" scope needs more than one. */
  selectedPages: number[]
  presets: ScalePreset[]
  onApply: (scale: Scale, pages: number[], updateExisting: boolean) => void
  onSavePreset: (preset: ScalePreset) => void
  onDeletePreset: (id: string) => void
  /** Saves the list of saved scales as a file, and reads such a file into the list. */
  onExportList?: () => void
  onImportList?: () => void
  onClose: () => void
}

/**
 * The Scale dialog: a ratio (named or typed, or "X mm on paper = Y m"), the units results are shown in, their
 * precision, and which pages it applies to. Scales can be saved as presets.
 */
export function ScaleDialog({ pageCount, currentPage, selectedPages, presets, onApply, onSavePreset, onDeletePreset, onExportList, onImportList, onClose }: Props) {
  const [mode, setMode] = useState<'ratio' | 'custom'>('ratio')
  const [choice, setChoice] = useState('100')
  const [typed, setTyped] = useState('1:75')
  const [paperMm, setPaperMm] = useState('10')
  const [real, setReal] = useState('1')
  const [realUnit, setRealUnit] = useState('m')
  const [unit, setUnit] = useState('m')
  const [prec, setPrec] = useState<'auto' | 'decimals' | 'fraction'>('auto')
  const [decimals, setDecimals] = useState(2)
  const [fraction, setFraction] = useState(16)
  const [scope, setScope] = useState<ScaleScope>('page')
  const [update, setUpdate] = useState(true)
  const [presetName, setPresetName] = useState('')

  const num = (s: string) => Number(s.replace(',', '.'))
  const precision: Precision | undefined = prec === 'decimals' ? { decimals } : prec === 'fraction' && isImperial(unit) ? { fraction } : undefined

  const result = useMemo((): { scale: Scale; ratio: number } | { error: string } => {
    try {
      const ratio = mode === 'custom' ? ratioFromCustom(num(paperMm), num(real), realUnit) : choice === 'other' ? parseRatio(typed) : Number(choice)
      if (!ratio || !(ratio > 0)) return { error: t('Enter a ratio such as 1:75.') }
      const label = mode === 'custom' ? `${num(paperMm)} mm = ${num(real)} ${realUnit}` : ratioText(ratio)
      return { scale: { factor: factorForRatio(ratio, unit), unit, source: 'set', label, precision }, ratio }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [mode, choice, typed, paperMm, real, realUnit, unit, precision]) // eslint-disable-line react-hooks/exhaustive-deps

  const pages = scope === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : scope === 'selected' ? selectedPages : [currentPage]
  const canSelected = selectedPages.length > 1

  const loadPreset = (id: string) => {
    const p = presets.find((x) => x.id === id)
    if (!p) return
    setMode('ratio')
    if ((PRESET_RATIOS as readonly number[]).includes(p.ratio)) setChoice(String(p.ratio))
    else {
      setChoice('other')
      setTyped(ratioText(p.ratio))
    }
    setUnit(p.unit)
    if (p.fraction) {
      setPrec('fraction')
      setFraction(p.fraction)
    } else if (typeof p.decimals === 'number') {
      setPrec('decimals')
      setDecimals(p.decimals)
    } else setPrec('auto')
    setPresetName(p.name)
  }

  const savePreset = () => {
    if (!('scale' in result)) return
    const name = presetName.trim() || `${result.scale.label} (${unit})`
    const existing = presets.find((p) => p.name === name)
    onSavePreset({
      id: existing?.id ?? crypto.randomUUID(),
      name,
      ratio: result.ratio,
      unit,
      ...(precision && 'fraction' in precision ? { fraction: precision.fraction } : precision ? { decimals: precision.decimals } : {})
    })
  }

  return (
    <Modal title={t('Scale')} onClose={onClose}>
      <form
        className="marks-form scale-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if ('scale' in result && pages.length) onApply(result.scale, pages, update)
        }}
      >
        {presets.length > 0 && (
          <div className="marks-row">
            <label>
              {t('Saved scale')}
              <select aria-label={t('Saved scale')} value="" onChange={(e) => loadPreset(e.target.value)}>
                <option value="">{t('Choose a saved scale')}</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!presets.some((p) => p.name === presetName)}
              onClick={() => {
                const p = presets.find((x) => x.name === presetName)
                if (p) onDeletePreset(p.id)
              }}
            >
              {t('Delete saved scale')}
            </button>
          </div>
        )}

        <fieldset>
          <legend>{t('Ratio')}</legend>
          <label>
            <input type="radio" name="scale-mode" checked={mode === 'ratio'} onChange={() => setMode('ratio')} />
            {t('Drawing scale')}
            <select aria-label={t('Drawing scale')} value={choice} onChange={(e) => { setChoice(e.target.value); setMode('ratio') }}>
              {PRESET_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {ratioText(r)}
                </option>
              ))}
              <option value="other">{t('Other')}</option>
            </select>
          </label>
          {choice === 'other' && mode === 'ratio' && (
            <input aria-label={t('Ratio')} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="1:75" />
          )}
          <label>
            <input type="radio" name="scale-mode" checked={mode === 'custom'} onChange={() => setMode('custom')} />
            {t('Custom')}
            <input aria-label={t('Paper length (mm)')} className="narrow" inputMode="decimal" value={paperMm} onChange={(e) => { setPaperMm(e.target.value); setMode('custom') }} />
            {t('mm on paper =')}
            <input aria-label={t('Real length')} className="narrow" inputMode="decimal" value={real} onChange={(e) => { setReal(e.target.value); setMode('custom') }} />
            <select aria-label={t('Real unit')} value={realUnit} onChange={(e) => { setRealUnit(e.target.value); setMode('custom') }}>
              {UNITS.filter((u) => u !== 'ft-in').map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>{t('Results')}</legend>
          <label>
            {t('Units')}
            <select aria-label={t('Units')} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u === 'ft-in' ? t('ft-in (feet and inches)') : u}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Precision')}
            <select aria-label={t('Precision')} value={prec === 'fraction' && !isImperial(unit) ? 'auto' : prec} onChange={(e) => setPrec(e.target.value as typeof prec)}>
              <option value="auto">{t('Automatic')}</option>
              <option value="decimals">{t('Decimal places')}</option>
              {isImperial(unit) && <option value="fraction">{t('Fractions')}</option>}
            </select>
          </label>
          {prec === 'decimals' && (
            <input aria-label={t('Decimal places')} className="narrow" type="number" min={0} max={6} value={decimals} onChange={(e) => setDecimals(Math.min(6, Math.max(0, Math.floor(Number(e.target.value)) || 0)))} />
          )}
          {prec === 'fraction' && isImperial(unit) && (
            <select aria-label={t('Smallest fraction')} value={fraction} onChange={(e) => setFraction(Number(e.target.value))}>
              {FRACTIONS.map((f) => (
                <option key={f} value={f}>
                  1/{f}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        <fieldset>
          <legend>{t('Apply to')}</legend>
          <label>
            <input type="radio" name="scale-scope" checked={scope === 'page'} onChange={() => setScope('page')} />
            {t('This page only')} ({currentPage + 1})
          </label>
          <label>
            <input type="radio" name="scale-scope" checked={scope === 'selected'} disabled={!canSelected} onChange={() => setScope('selected')} />
            {t('Selected pages')} ({selectedPages.length})
          </label>
          <label>
            <input type="radio" name="scale-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
            {t('Whole document')} ({pageCount})
          </label>
        </fieldset>

        <label className="inline">
          <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
          {t('Also update measurements already made on these pages')}
        </label>

        <p className="muted" aria-label={t('Preview')}>
          {'scale' in result ? `${t('Preview')}: 10 mm ${t('on paper is')} ${formatLength(10 / MM_PER_PT, result.scale)}` : result.error}
        </p>

        <div className="marks-row">
          <input aria-label={t('Name for this scale')} placeholder={t('Name for this scale')} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
          <button type="button" disabled={!('scale' in result)} onClick={savePreset}>
            {t('Save scale')}
          </button>
        </div>

        {(onExportList || onImportList) && (
          <div className="marks-row">
            {onExportList && (
              <button type="button" disabled={!presets.length} onClick={onExportList} title={t('Save the list of saved scales as a file to share')}>
                {t('Export saved scales…')}
              </button>
            )}
            {onImportList && (
              <button type="button" onClick={onImportList} title={t('Add the scales from a file; a scale with the same name is replaced')}>
                {t('Import saved scales…')}
              </button>
            )}
          </div>
        )}

        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit" disabled={!('scale' in result) || !pages.length}>
            {t('Set scale')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
