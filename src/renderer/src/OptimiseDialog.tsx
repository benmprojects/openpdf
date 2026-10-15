import { useState } from 'react'
import { Modal } from './AppDialogs'
import type { OptimiseOptions } from './optimise'
import { t } from './i18n'

const PRESETS: { key: string; label: string; maxDpi: number | null; quality: number }[] = [
  { key: 'screen', label: 'Smallest file (screen, 96 dpi)', maxDpi: 96, quality: 0.6 },
  { key: 'balanced', label: 'Balanced (150 dpi)', maxDpi: 150, quality: 0.75 },
  { key: 'print', label: 'Print quality (300 dpi)', maxDpi: 300, quality: 0.85 },
  { key: 'lossless', label: 'Lossless (leave pictures alone)', maxDpi: null, quality: 0.85 }
]

export function formatSize(n: number): string {
  return n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** Options for Optimise; the size before is shown so the result can be compared. */
export function OptimiseDialog({ size, onApply, onClose }: { size: number; onApply: (o: OptimiseOptions) => void; onClose: () => void }) {
  const [preset, setPreset] = useState('balanced')
  const p = PRESETS.find((x) => x.key === preset)!
  const [dpi, setDpi] = useState<number | null>(p.maxDpi)
  const [quality, setQuality] = useState(p.quality)
  const [thumbs, setThumbs] = useState(true)
  const [objectStreams, setObjectStreams] = useState(true)
  const [recompress, setRecompress] = useState(true)
  const [unused, setUnused] = useState(true)
  const [linearise, setLinearise] = useState(false)
  return (
    <Modal title={t('Optimise')} onClose={onClose}>
      <form
        className="marks-form"
        onSubmit={(e) => {
          e.preventDefault()
          onApply({ maxDpi: dpi, quality, dropThumbnails: thumbs, objectStreams, recompress, removeUnusedResources: unused, linearise })
        }}
      >
        <p className="muted">Current size: {formatSize(size)}. The changes can be undone until you save.</p>
        <label className="inline">
          Preset
          <select
            aria-label="Preset"
            value={preset}
            onChange={(e) => {
              const n = PRESETS.find((x) => x.key === e.target.value)!
              setPreset(n.key)
              setDpi(n.maxDpi)
              setQuality(n.quality)
            }}
          >
            {PRESETS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="marks-remove">
          <legend>Pictures</legend>
          <label className="inline">
            <input type="checkbox" checked={dpi !== null} onChange={(e) => setDpi(e.target.checked ? (p.maxDpi ?? 150) : null)} /> Reduce pictures above
            <input type="number" aria-label="Resolution" min={36} max={1200} value={dpi ?? 150} disabled={dpi === null} onChange={(e) => setDpi(Math.max(36, Number(e.target.value) || 150))} /> dpi
          </label>
          <label className="inline">
            JPEG quality
            <input type="range" aria-label="JPEG quality" min={0.3} max={0.95} step={0.05} value={quality} disabled={dpi === null} onChange={(e) => setQuality(Number(e.target.value))} />
            {Math.round(quality * 100)}%
          </label>
        </fieldset>
        <fieldset className="marks-remove">
          <legend>File structure</legend>
          <label className="inline">
            <input type="checkbox" checked={objectStreams} onChange={(e) => setObjectStreams(e.target.checked)} /> Compress the document structure (object streams)
          </label>
          <label className="inline">
            <input type="checkbox" checked={recompress} onChange={(e) => setRecompress(e.target.checked)} /> Recompress streams at the highest level
          </label>
          <label className="inline">
            <input type="checkbox" checked={unused} onChange={(e) => setUnused(e.target.checked)} /> Remove unused fonts, pictures and other resources
          </label>
          <label className="inline">
            <input type="checkbox" checked={thumbs} onChange={(e) => setThumbs(e.target.checked)} /> Remove embedded page thumbnails
          </label>
          <label className="inline">
            <input type="checkbox" checked={linearise} onChange={(e) => setLinearise(e.target.checked)} /> Linearise for fast web view
          </label>
        </fieldset>
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Optimise
          </button>
        </div>
      </form>
    </Modal>
  )
}
