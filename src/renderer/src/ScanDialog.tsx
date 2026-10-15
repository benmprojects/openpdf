import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import type { ScanOptions, ScannerInfo } from '../../main/scan'

export interface ScanRequest extends ScanOptions {
  /** Recognise the text after scanning so the result can be searched. */
  ocr: boolean
}

/** Scanner, source, colour and resolution. */
export function ScanDialog({ onScan, onClose }: { onScan: (r: ScanRequest) => void; onClose: () => void }) {
  const [scanners, setScanners] = useState<ScannerInfo[] | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [source, setSource] = useState<ScanOptions['source']>('dialog')
  const [color, setColor] = useState<ScanOptions['color']>('color')
  const [dpi, setDpi] = useState<ScanOptions['dpi']>(200)
  const [ocr, setOcr] = useState(true)

  useEffect(() => {
    let live = true
    window.openpdf
      .listScanners()
      .then((s) => live && setScanners(s))
      .catch(() => live && setScanners([]))
    return () => {
      live = false
    }
  }, [])

  const direct = source !== 'dialog'
  return (
    <Modal title="Scan to PDF" onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onScan({ source, dpi, color, deviceId: direct ? deviceId : undefined, ocr })
        }}
      >
        {scanners && scanners.length === 0 && <p className="muted">Windows does not list a scanner. Check that it is switched on and its driver is installed.</p>}
        <label className="props-row">
          <span>Method</span>
          <select aria-label="Method" value={source} onChange={(e) => setSource(e.target.value as ScanOptions['source'])}>
            <option value="dialog">Use the scanner&rsquo;s own window (preview and settings)</option>
            <option value="flatbed">Scan from the glass, using these settings</option>
            <option value="feeder">Scan every sheet in the feeder, using these settings</option>
          </select>
        </label>
        {direct && (
          <>
            <label className="props-row">
              <span>Scanner</span>
              <select aria-label="Scanner" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">First scanner found</option>
                {scanners?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="props-row">
              <span>Colour</span>
              <select aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value as ScanOptions['color'])}>
                <option value="color">Colour</option>
                <option value="gray">Greyscale</option>
                <option value="bw">Black and white</option>
              </select>
            </label>
            <label className="props-row">
              <span>Resolution</span>
              <select aria-label="Resolution" value={dpi} onChange={(e) => setDpi(Number(e.target.value) as ScanOptions['dpi'])}>
                {[100, 150, 200, 300, 600].map((d) => (
                  <option key={d} value={d}>
                    {d} dpi
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="inline">
          <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} /> Make the scan searchable (recognise the text, in English)
        </label>
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Scan
          </button>
        </div>
      </form>
    </Modal>
  )
}
