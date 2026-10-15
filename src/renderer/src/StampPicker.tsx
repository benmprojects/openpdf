import { ImagePlus, Stamp, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ImageStamp } from '../../preload'
import { STAMP_LABELS } from './annotations'

export type StampChoice = { kind: 'text'; label: string } | { kind: 'image'; stamp: ImageStamp }

interface Props {
  choice: StampChoice
  dated: boolean
  images: ImageStamp[]
  onPick: (c: StampChoice) => void
  onDated: (on: boolean) => void
  onAddImages: () => void
  onRemoveImage: (id: string) => void
  onClose: () => void
}

/** The stamp palette: built-in text stamps, the user's image stamps, and the name-and-date option. */
export function StampPicker({ choice, dated, images, onPick, onDated, onAddImages, onRemoveImage, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !panel.current?.contains(e.target as Node)) onClose()
    }
    // Wait a tick so the click that opened the picker does not close it.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', away)
      window.addEventListener('keydown', away)
    })
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', away)
    }
  }, [onClose])
  return (
    <div ref={panel} className="stamp-picker" role="dialog" aria-label="Stamps">
      <h4>Text stamps</h4>
      <div className="stamp-grid">
        {STAMP_LABELS.map((l) => (
          <button
            key={l}
            className={choice.kind === 'text' && choice.label === l ? 'stamp-chip on' : 'stamp-chip'}
            onClick={() => onPick({ kind: 'text', label: l })}
          >
            {l}
          </button>
        ))}
      </div>
      <label className="stamp-dated">
        <input type="checkbox" checked={dated} onChange={(e) => onDated(e.target.checked)} /> Add my name, date and time
      </label>
      <h4>My image stamps</h4>
      <div className="stamp-images">
        {images.map((s) => (
          <div key={s.id} className={choice.kind === 'image' && choice.stamp.id === s.id ? 'stamp-image on' : 'stamp-image'}>
            <button onClick={() => onPick({ kind: 'image', stamp: s })} title={s.name} aria-label={`Image stamp ${s.name}`}>
              <img src={s.dataUrl} alt="" />
            </button>
            <button className="stamp-remove" onClick={() => onRemoveImage(s.id)} aria-label={`Remove ${s.name}`} title="Remove from my stamps">
              <X size={12} aria-hidden />
            </button>
          </div>
        ))}
        <button className="stamp-add" onClick={onAddImages} title="Add PNG or JPEG images as stamps">
          <ImagePlus size={20} strokeWidth={1.6} aria-hidden />
          <span>Add image…</span>
        </button>
      </div>
      <p className="muted small">
        <Stamp size={12} aria-hidden /> Pick a stamp, then click on the page.
      </p>
    </div>
  )
}
