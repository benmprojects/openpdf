import { useState } from 'react'
import { Modal } from './AppDialogs'
import type { ImageFormat } from './exportDoc'

export interface ExportImagesRequest {
  format: ImageFormat
  dpi: number
  scope: 'all' | 'current'
}

/** Page images: format, resolution and which pages. */
export function ExportImagesDialog({ pageCount, currentPage, onExport, onClose }: { pageCount: number; currentPage: number; onExport: (r: ExportImagesRequest) => void; onClose: () => void }) {
  const [format, setFormat] = useState<ImageFormat>('png')
  const [dpi, setDpi] = useState(150)
  const [scope, setScope] = useState<'all' | 'current'>('all')
  return (
    <Modal title="Export pages as pictures" onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onExport({ format, dpi, scope })
        }}
      >
        <label className="props-row">
          <span>Format</span>
          <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)}>
            <option value="png">PNG (sharp text, lossless)</option>
            <option value="jpg">JPEG (smaller photos)</option>
            <option value="tiff">TIFF (uncompressed)</option>
          </select>
        </label>
        <label className="props-row">
          <span>Resolution</span>
          <select aria-label="Resolution" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            {[72, 96, 150, 200, 300, 600].map((d) => (
              <option key={d} value={d}>
                {d} dpi
              </option>
            ))}
          </select>
        </label>
        <label className="props-row">
          <span>Pages</span>
          <select aria-label="Pages" value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'current')} disabled={pageCount < 2}>
            <option value="all">All {pageCount} page{pageCount === 1 ? '' : 's'}</option>
            <option value="current">Page {currentPage + 1} only</option>
          </select>
        </label>
        <p className="muted">One file per page is saved in the folder you choose; existing files are never overwritten.</p>
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Export
          </button>
        </div>
      </form>
    </Modal>
  )
}
