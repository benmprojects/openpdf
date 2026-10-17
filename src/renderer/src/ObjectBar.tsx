import { useState } from 'react'
import { Crop, Download, Droplets, FlipHorizontal2, FlipVertical2, ImageIcon, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import type { Matrix6 } from './content'
import { flipHorizontal, flipVertical, lineWidthInPoints, rotateAbout, type Inset } from './objectOps'
import type { PathRestyle } from './pathEdit'
import type { ImageObject } from './pdfClient'
import { msg, t } from './i18n'

/** What the bar asks the document view to do, besides moving, resizing and deleting. */
export type ObjectAction =
  | { kind: 'crop'; obj: ImageObject; inset: Inset }
  | { kind: 'opacity'; obj: ImageObject; value: number }
  | { kind: 'export'; obj: ImageObject }
  | { kind: 'restyle'; obj: ImageObject; change: PathRestyle }

const SIDE_LABEL = { left: msg('Left'), top: msg('Top'), right: msg('Right'), bottom: msg('Bottom') }
const TRIM_LABEL = { left: msg('Trim left (points)'), top: msg('Trim top (points)'), right: msg('Trim right (points)'), bottom: msg('Trim bottom (points)') }

const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s))

/** The floating tool bar over a selected picture or shape. */
export function ObjectBar({
  isPath,
  obj,
  left,
  top,
  onDisplayChange,
  onDelete,
  onReplace,
  onCropByDrag,
  cropping,
  onAction
}: {
  isPath: boolean
  obj: ImageObject
  left: number
  top: number
  /** A change as a matrix in display space (y down); the layer turns it into page space. */
  onDisplayChange: (m: Matrix6) => void
  onDelete: () => void
  onReplace?: () => void
  /** Turns on dragging the picture's edges to trim it. */
  onCropByDrag?: () => void
  cropping?: boolean
  onAction: (a: ObjectAction) => void
}) {
  const [open, setOpen] = useState<'rotate' | 'crop' | 'opacity' | null>(null)
  const [angle, setAngle] = useState('15')
  const [inset, setInset] = useState({ left: '0', top: '0', right: '0', bottom: '0' })
  const [opacity, setOpacity] = useState('100')
  const [problem, setProblem] = useState<string | null>(null)
  const style = obj.style
  const [stroke, setStroke] = useState(style?.stroke ?? '#000000')
  const [fill, setFill] = useState(style?.fill ?? '#000000')
  const [width, setWidth] = useState(() => (style ? String(Math.round(lineWidthInPoints(style.strokeWidth, obj.matrix) * 100) / 100) : '1'))
  const [dash, setDash] = useState<'keep' | 'solid' | 'dashed' | 'dotted'>('keep')
  const [grad, setGrad] = useState(false)
  const [gradFrom, setGradFrom] = useState(style?.fill ?? '#ff0000')
  const [gradTo, setGradTo] = useState('#0000ff')
  const [gradAngle, setGradAngle] = useState('0')
  const cx = obj.rect.x + obj.rect.w / 2
  const cy = obj.rect.y + obj.rect.h / 2
  const toggle = (k: 'rotate' | 'crop' | 'opacity') => {
    setProblem(null)
    setOpen(open === k ? null : k)
  }
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  const percent = (): number | null => {
    const v = num(opacity)
    if (!(v >= 0 && v <= 100)) {
      setProblem(t('Opacity is a percentage from 0 to 100.'))
      return null
    }
    return v / 100
  }

  return (
    <div className="imageedit-bar" style={{ left, top }} onMouseDown={stop} role="toolbar" aria-label={isPath ? t('Shape tools') : t('Picture tools')}>
      {!isPath && (
        <>
          <button type="button" aria-label={t('Rotate left 90°')} title={t('Rotate left 90°')} onClick={() => onDisplayChange(rotateAbout(-90, cx, cy))}>
            <RotateCcw size={14} aria-hidden />
          </button>
          <button type="button" aria-label={t('Rotate right 90°')} title={t('Rotate right 90°')} onClick={() => onDisplayChange(rotateAbout(90, cx, cy))}>
            <RotateCw size={14} aria-hidden />
          </button>
          <button type="button" aria-label={t('Rotate 180°')} title={t('Rotate 180°')} onClick={() => onDisplayChange(rotateAbout(180, cx, cy))}>
            180°
          </button>
          <button type="button" aria-label={t('Rotate by an angle…')} title={t('Rotate by any angle')} aria-expanded={open === 'rotate'} onClick={() => toggle('rotate')}>
            {t('Angle…')}
          </button>
          <button type="button" aria-label={t('Flip left to right')} title={t('Flip left to right')} onClick={() => onDisplayChange(flipHorizontal(cx))}>
            <FlipHorizontal2 size={14} aria-hidden />
          </button>
          <button type="button" aria-label={t('Flip top to bottom')} title={t('Flip top to bottom')} onClick={() => onDisplayChange(flipVertical(cy))}>
            <FlipVertical2 size={14} aria-hidden />
          </button>
          <button type="button" aria-label={t('Crop…')} title={t('Hide the edges of the picture')} aria-expanded={open === 'crop'} onClick={() => toggle('crop')}>
            <Crop size={14} aria-hidden /> {t('Crop…')}
          </button>
          {onCropByDrag && (
            <button type="button" aria-label={t('Crop by dragging')} aria-pressed={!!cropping} title={t('Drag the edges or corners of the picture to trim it')} onClick={onCropByDrag}>
              <Crop size={14} aria-hidden /> {t('Drag…')}
            </button>
          )}
          <button type="button" aria-label={t('Opacity…')} title={t('Make the picture see-through')} aria-expanded={open === 'opacity'} onClick={() => toggle('opacity')}>
            <Droplets size={14} aria-hidden /> {t('Opacity…')}
          </button>
          {onReplace && (
            <button type="button" onClick={onReplace} title={t('Replace this picture with another file')}>
              <ImageIcon size={14} aria-hidden /> {t('Replace…')}
            </button>
          )}
          <button type="button" aria-label={t('Export picture…')} title={t('Save this picture as a PNG file')} onClick={() => onAction({ kind: 'export', obj })}>
            <Download size={14} aria-hidden /> {t('Export…')}
          </button>
        </>
      )}
      {isPath && (
        <div className="objbar-style">
          <label title={style?.stroke ? undefined : t('This shape has no outline')}>
            <span>{t('Line')}</span>
            <input type="color" aria-label={t('Line colour')} value={stroke} disabled={!style?.stroke} onChange={(e) => setStroke(e.target.value)} />
          </label>
          <label title={style?.fill ? undefined : t('This shape has no fill')}>
            <span>{t('Fill')}</span>
            <input type="color" aria-label={t('Fill colour')} value={fill} disabled={!style?.fill} onChange={(e) => setFill(e.target.value)} />
          </label>
          <label title={style?.stroke ? undefined : t('This shape has no outline')}>
            <span>{t('Width')}</span>
            <input aria-label={t('Line width (points)')} inputMode="decimal" size={4} value={width} disabled={!style?.stroke} onChange={(e) => setWidth(e.target.value)} />
          </label>
          <label>
            <span>{t('Opacity')}</span>
            <input aria-label={t('Opacity (percent)')} inputMode="numeric" size={4} value={opacity} onChange={(e) => setOpacity(e.target.value)} />
          </label>
          <label title={style?.stroke ? undefined : t('This shape has no outline')}>
            <span>{t('Dash')}</span>
            <select aria-label={t('Line style')} value={dash} disabled={!style?.stroke} onChange={(e) => setDash(e.target.value as typeof dash)}>
              <option value="keep">{t('As it is')}</option>
              <option value="solid">{t('Solid')}</option>
              <option value="dashed">{t('Dashed')}</option>
              <option value="dotted">{t('Dotted')}</option>
            </select>
          </label>
          <label title={style?.fill ? undefined : t('This shape has no fill')}>
            <input type="checkbox" aria-label={t('Gradient fill')} checked={grad} disabled={!style?.fill} onChange={(e) => setGrad(e.target.checked)} />
            <span>{t('Gradient')}</span>
          </label>
          {grad && (
            <>
              <input type="color" aria-label={t('Gradient start colour')} value={gradFrom} onChange={(e) => setGradFrom(e.target.value)} />
              <input type="color" aria-label={t('Gradient end colour')} value={gradTo} onChange={(e) => setGradTo(e.target.value)} />
              <select aria-label={t('Gradient direction')} value={gradAngle} onChange={(e) => setGradAngle(e.target.value)}>
                <option value="0">{t('Left to right')}</option>
                <option value="180">{t('Right to left')}</option>
                <option value="270">{t('Top to bottom')}</option>
                <option value="90">{t('Bottom to top')}</option>
              </select>
            </>
          )}
          <button
            type="button"
            aria-label={t('Apply look')}
            onClick={() => {
              const change: PathRestyle = {}
              if (dash !== 'keep') change.dash = dash === 'solid' ? 'solid' : dash === 'dashed' ? { on: 6, off: 3 } : { on: 1, off: 3 }
              if (grad) change.gradient = { from: gradFrom, to: gradTo, angle: Number(gradAngle) }
              if (style?.stroke && stroke !== style.stroke) change.stroke = stroke
              if (style?.fill && fill !== style.fill) change.fill = fill
              if (style?.stroke) {
                const w = num(width)
                if (!(w >= 0)) return setProblem(t('The line width must be zero or more.'))
                if (Math.abs(w - lineWidthInPoints(style.strokeWidth, obj.matrix)) > 0.005) change.lineWidth = w
              }
              if (opacity !== '100') {
                const v = percent()
                if (v === null) return
                change.opacity = v
              }
              if (Object.keys(change).length === 0) return setProblem(t('Nothing has changed yet.'))
              setProblem(null)
              onAction({ kind: 'restyle', obj, change })
            }}
          >
            {t('Apply')}
          </button>
        </div>
      )}
      <button type="button" onClick={onDelete} title={isPath ? t('Delete this shape (Delete)') : t('Delete this picture (Delete)')}>
        <Trash2 size={14} aria-hidden /> {t('Delete')}
      </button>
      {open === 'rotate' && !isPath && (
        <div className="objbar-pop">
          <label>
            <span>{t('Turn clockwise by (degrees)')}</span>
            <input aria-label={t('Angle in degrees')} inputMode="decimal" size={5} value={angle} onChange={(e) => setAngle(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => {
              const a = num(angle)
              if (!Number.isFinite(a) || a === 0) return setProblem(t('Enter an angle, for example 15 or -7.5.'))
              setProblem(null)
              onDisplayChange(rotateAbout(a, cx, cy))
            }}
          >
            {t('Rotate')}
          </button>
        </div>
      )}
      {open === 'crop' && !isPath && (
        <div className="objbar-pop">
          {(['left', 'top', 'right', 'bottom'] as const).map((side) => (
            <label key={side}>
              <span>{t(SIDE_LABEL[side])}</span>
              <input aria-label={t(TRIM_LABEL[side])} inputMode="decimal" size={4} value={inset[side]} onChange={(e) => setInset({ ...inset, [side]: e.target.value })} />
            </label>
          ))}
          <span className="muted">{t('points, from each edge as shown')}</span>
          <button
            type="button"
            onClick={() => {
              const v: Inset = { left: num(inset.left), top: num(inset.top), right: num(inset.right), bottom: num(inset.bottom) }
              if (Object.values(v).some((x) => !(x >= 0))) return setProblem(t('Enter how much to trim from each edge, zero or more.'))
              if (v.left + v.right >= obj.rect.w || v.top + v.bottom >= obj.rect.h) return setProblem(t('That would trim away the whole picture.'))
              setProblem(null)
              onAction({ kind: 'crop', obj, inset: v })
            }}
          >
            {t('Crop')}
          </button>
        </div>
      )}
      {open === 'opacity' && !isPath && (
        <div className="objbar-pop">
          <label>
            <span>{t('Opacity (percent)')}</span>
            <input aria-label={t('Opacity (percent)')} inputMode="numeric" size={4} value={opacity} onChange={(e) => setOpacity(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => {
              const v = percent()
              if (v === null) return
              setProblem(null)
              onAction({ kind: 'opacity', obj, value: v })
            }}
          >
            {t('Set')}
          </button>
        </div>
      )}
      {problem && (
        <p className="objbar-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
