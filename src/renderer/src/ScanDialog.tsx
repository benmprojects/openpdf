import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import type { ScanCapabilities, ScanOptions, ScannerInfo } from '../../main/scan'
import { insertIndex, type InsertWhere } from './pageDialogLogic'
import { allPresets, BUILT_IN_PRESETS, deletePreset, loadPresets, savePreset, storePresets, type ScanPreset } from './scanPresets'
import { t } from './i18n'

export interface ScanRequest extends ScanOptions {
  /** Recognise the text after scanning so the result can be searched. */
  ocr: boolean
  /** Languages for the recognition (Tesseract codes); English when empty. */
  ocrLanguages: string[]
  /** Straighten crooked sheets (before the text is recognised). */
  deskew: boolean
  /** Remove isolated specks. */
  despeckle: boolean
  /** Cut each sheet down to its content. */
  autoCrop: boolean
  /** 0-based index to insert the scanned pages at in the open document; a new document when absent. */
  insertAt?: number
}

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

/**
 * Scanner, source, colour, resolution, paper, clean-up and text recognition, with saved presets. Given `document`,
 * it can also add the pages to the open document instead of making a new one.
 */
export function ScanDialog({ onScan, onClose, document }: { onScan: (r: ScanRequest) => void; onClose: () => void; document?: { count: number; current: number } }) {
  const [scanners, setScanners] = useState<ScannerInfo[] | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [source, setSource] = useState<ScanOptions['source']>('dialog')
  const [color, setColor] = useState<ScanOptions['color']>('color')
  const [dpi, setDpi] = useState<ScanOptions['dpi']>(200)
  const [paper, setPaper] = useState<NonNullable<ScanOptions['paper']>>('auto')
  const [duplex, setDuplex] = useState(false)
  const [capsFor, setCapsFor] = useState<{ id: string; caps: ScanCapabilities } | null>(null)
  const [deskew, setDeskew] = useState(false)
  const [despeckle, setDespeckle] = useState(false)
  const [autoCrop, setAutoCrop] = useState(false)
  const [ocr, setOcr] = useState(true)
  const [ocrLang, setOcrLang] = useState('eng')
  const [languages, setLanguages] = useState<[string, string][]>([['eng', 'English']])
  const [installed, setInstalled] = useState<string[]>(['eng'])
  const [userPresets, setUserPresets] = useState<ScanPreset[]>(() => loadPresets())
  const [presetName, setPresetName] = useState('')
  const [presetError, setPresetError] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [chosenPreset, setChosenPreset] = useState('')
  const [dest, setDest] = useState<'new' | 'here'>('new')
  const [where, setWhere] = useState<InsertWhere>({ side: 'after', target: 'page', page: document ? Math.min(Math.max(1, document.current + 1), document.count) : 1 })

  useEffect(() => {
    let live = true
    window.openpdf
      .listScanners()
      .then((s) => live && setScanners(s))
      .catch(() => live && setScanners([]))
    window.openpdf
      .ocrLanguages()
      .then((l) => {
        if (!live) return
        setLanguages(l.all)
        setInstalled(l.installed)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const direct = source !== 'dialog'
  // Duplex is only offered when the chosen scanner says it can do it.
  useEffect(() => {
    if (source !== 'feeder') return
    let live = true
    window.openpdf
      .scanCapabilities(deviceId || undefined)
      .then((c) => live && setCapsFor({ id: deviceId, caps: c }))
      .catch(() => live && setCapsFor({ id: deviceId, caps: { feeder: false, duplex: false } }))
    return () => {
      live = false
    }
  }, [source, deviceId])
  const caps = capsFor && capsFor.id === deviceId ? capsFor.caps : null
  const canDuplex = source === 'feeder' && caps?.duplex === true

  const applyPreset = (p: ScanPreset) => {
    setSource(p.source)
    setDeviceId(p.deviceId ?? '')
    setDpi(p.dpi)
    setColor(p.color)
    setPaper(p.paper)
    setDuplex(p.duplex)
    setDeskew(p.deskew)
    setDespeckle(p.despeckle)
    setAutoCrop(p.autoCrop)
    setOcr(p.ocr)
    setOcrLang(p.ocrLanguages[0] ?? 'eng')
  }
  const choosePreset = (name: string) => {
    setChosenPreset(name)
    setNaming(false)
    const p = allPresets(userPresets).find((q) => q.name === name)
    if (p) applyPreset(p)
  }
  const commitPreset = () => {
    const preset: ScanPreset = { name: presetName.trim(), source, deviceId: direct && deviceId ? deviceId : undefined, dpi, color, paper, duplex, deskew, despeckle, autoCrop, ocr, ocrLanguages: [ocrLang] }
    const r = savePreset(userPresets, preset)
    if (r.error) return setPresetError(t(r.error))
    setUserPresets(r.list)
    storePresets(r.list)
    setChosenPreset(preset.name)
    setNaming(false)
    setPresetName('')
    setPresetError(null)
  }
  const removePreset = () => {
    const list = deletePreset(userPresets, chosenPreset)
    setUserPresets(list)
    storePresets(list)
    setChosenPreset('')
  }
  const isUserPreset = userPresets.some((p) => p.name === chosenPreset)

  const loc = document && dest === 'here' ? insertIndex(where, document.count) : null
  const langName = (c: string) => languages.find(([k]) => k === c)?.[1] ?? c

  return (
    <Modal title={t('Scan to PDF')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (loc?.error) return
          onScan({
            source,
            dpi,
            color,
            deviceId: direct ? deviceId : undefined,
            paper: direct ? paper : undefined,
            duplex: canDuplex && duplex,
            ocr,
            ocrLanguages: [ocrLang],
            deskew,
            despeckle,
            autoCrop,
            insertAt: loc ? loc.index : undefined
          })
        }}
      >
        {scanners && scanners.length === 0 && <p className="muted">{t('Windows does not list a scanner. Check that it is switched on and its driver is installed.')}</p>}
        <label className="props-row">
          <span>{t('Preset')}</span>
          <select aria-label="Preset" value={chosenPreset} onChange={(e) => choosePreset(e.target.value)}>
            <option value="">{t('(none chosen)')}</option>
            <optgroup label={t('Built in')}>
              {BUILT_IN_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {userPresets.length > 0 && (
              <optgroup label={t('Saved')}>
                {userPresets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="props-row">
          <span />
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {naming ? (
              <>
                <input
                  aria-label={t('Preset name')}
                  value={presetName}
                  autoFocus
                  placeholder={t('Name for this preset')}
                  onChange={(e) => {
                    setPresetName(e.target.value)
                    setPresetError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitPreset()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      setNaming(false)
                    }
                  }}
                />
                <button type="button" onClick={commitPreset}>
                  {t('Save')}
                </button>
                <button type="button" onClick={() => setNaming(false)}>
                  {t('Cancel')}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setNaming(true)}>
                  {t('Save preset')}
                </button>
                <button type="button" onClick={removePreset} disabled={!isUserPreset}>
                  {t('Delete preset')}
                </button>
              </>
            )}
          </span>
        </div>
        {presetError && (
          <p className="muted" role="alert">
            {presetError}
          </p>
        )}
        <label className="props-row">
          <span>{t('Method')}</span>
          <select aria-label="Method" value={source} onChange={(e) => setSource(e.target.value as ScanOptions['source'])}>
            <option value="dialog">{t('Use the scanner’s own window (preview and settings)')}</option>
            <option value="flatbed">{t('Scan from the glass, using these settings')}</option>
            <option value="feeder">{t('Scan every sheet in the feeder, using these settings')}</option>
          </select>
        </label>
        {direct && (
          <>
            <label className="props-row">
              <span>{t('Scanner')}</span>
              <select aria-label="Scanner" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">{t('First scanner found')}</option>
                {scanners?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="props-row">
              <span>{t('Colour')}</span>
              <select aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value as ScanOptions['color'])}>
                <option value="color">{t('Colour')}</option>
                <option value="gray">{t('Greyscale')}</option>
                <option value="bw">{t('Black and white')}</option>
              </select>
            </label>
            <label className="props-row">
              <span>{t('Resolution')}</span>
              <select aria-label="Resolution" value={dpi} onChange={(e) => setDpi(Number(e.target.value) as ScanOptions['dpi'])}>
                {[100, 150, 200, 300, 600].map((d) => (
                  <option key={d} value={d}>
                    {d} dpi
                  </option>
                ))}
              </select>
            </label>
            <label className="props-row">
              <span>{t('Paper size')}</span>
              <select aria-label="Paper size" value={paper} onChange={(e) => setPaper(e.target.value as NonNullable<ScanOptions['paper']>)}>
                <option value="auto">{t('Scanner default')}</option>
                <option value="a4">A4</option>
                <option value="a5">A5</option>
                <option value="a3">A3</option>
                <option value="letter">Letter</option>
                <option value="legal">Legal</option>
              </select>
            </label>
            {source === 'feeder' && (
              <label className="inline">
                <input type="checkbox" aria-label="Scan both sides (duplex)" checked={canDuplex && duplex} disabled={!canDuplex} onChange={(e) => setDuplex(e.target.checked)} /> {t('Scan both sides of each sheet (duplex)')}
                {!canDuplex && <span className="muted small"> {caps === null ? t('Checking what this scanner can do…') : t('This scanner does not report two-sided scanning.')}</span>}
              </label>
            )}
          </>
        )}
        <fieldset className="pod-group">
          <legend>{t('Clean up each sheet')}</legend>
          <label className="inline">
            <input type="checkbox" aria-label="Straighten pages" checked={deskew} onChange={(e) => setDeskew(e.target.checked)} /> {t('Straighten pages')}
          </label>
          <label className="inline">
            <input type="checkbox" aria-label="Remove specks" checked={despeckle} onChange={(e) => setDespeckle(e.target.checked)} /> {t('Remove specks')}
          </label>
          <label className="inline">
            <input type="checkbox" aria-label="Crop to content" checked={autoCrop} onChange={(e) => setAutoCrop(e.target.checked)} /> {t('Crop to content')}
          </label>
        </fieldset>
        <label className="inline">
          <input type="checkbox" aria-label="Make the scan searchable" checked={ocr} onChange={(e) => setOcr(e.target.checked)} /> {t('Make the scan searchable (recognise the text)')}
        </label>
        {ocr && (
          <>
            <label className="props-row">
              <span>{t('Language')}</span>
              <select aria-label="OCR language" value={ocrLang} onChange={(e) => setOcrLang(e.target.value)}>
                {languages.map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                    {installed.includes(c) ? '' : t(' (downloads on first use)')}
                  </option>
                ))}
              </select>
            </label>
            {deskew && <p className="muted small">{t('Sheets are straightened before the text is recognised.')}</p>}
            {!installed.includes(ocrLang) && <p className="muted small">{t('The language data for {language} is downloaded once from the internet (a few megabytes) and kept on this computer.', { language: langName(ocrLang) })}</p>}
          </>
        )}
        {document && (
          <fieldset className="pod-group">
            <legend>{t('Add the scan to')}</legend>
            <label className="pod-radio">
              <input type="radio" name="scan-destination" checked={dest === 'new'} onChange={() => setDest('new')} /> {t('A new document')}
            </label>
            <label className="pod-radio">
              <input type="radio" name="scan-destination" checked={dest === 'here'} onChange={() => setDest('here')} /> {t('This document')}
            </label>
            {dest === 'here' && (
              <>
                <div className="pod-field">
                  <select aria-label={t('Before or after')} value={where.side} onChange={(e) => setWhere({ ...where, side: e.target.value as 'before' | 'after' })}>
                    <option value="before">{t('Before')}</option>
                    <option value="after">{t('After')}</option>
                  </select>
                  <select aria-label={t('Page to insert next to')} value={where.target} onChange={(e) => setWhere({ ...where, target: e.target.value as InsertWhere['target'] })}>
                    <option value="first">{t('First page')}</option>
                    <option value="last">{t('Last page')}</option>
                    <option value="page">{t('Page number')}</option>
                  </select>
                  {where.target === 'page' && (
                    <input aria-label={t('Page number')} inputMode="numeric" value={Number.isNaN(where.page) ? '' : String(where.page)} onChange={(e) => setWhere({ ...where, page: num(e.target.value) })} />
                  )}
                  <span className="pod-hint">{t('of {count}', { count: document.count })}</span>
                </div>
                {loc?.error && (
                  <p className="muted" role="alert">
                    {loc.error}
                  </p>
                )}
              </>
            )}
          </fieldset>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit" disabled={!!loc?.error}>
            {t('Scan')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
