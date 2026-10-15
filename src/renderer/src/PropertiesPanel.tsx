import { Bookmark, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import {
  annotLabel,
  canDash,
  canFill,
  colorChoices,
  FONT_FAMILIES,
  formatWhen,
  hasFont,
  isShapeKind,
  LINE_WIDTHS,
  type Annot,
  type AnnotKind,
  type ToolStyle
} from './annotations'

export interface ToolPreset {
  id: string
  name: string
  kind: string
  style: ToolStyle
}

interface Props {
  /** The selected annotation, or null to edit the style of the current tool. */
  annot: Annot | null
  kind: AnnotKind
  /** The style shown: the selected annotation's, or the tool's. */
  style: ToolStyle & { color: string }
  onStyle: (patch: ToolStyle) => void
  onAuthor: (author: string) => void
  onMakeDefault: () => void
  presets: ToolPreset[]
  onSavePreset: (name: string) => void
  onUsePreset: (p: ToolPreset) => void
  onDeletePreset: (id: string) => void
  onClose: () => void
}

/** Every property of the selected annotation (or the current tool), with tool defaults and saved presets. */
export function PropertiesPanel({ annot, kind, style, onStyle, onAuthor, onMakeDefault, presets, onSavePreset, onUsePreset, onDeletePreset, onClose }: Props) {
  const [presetName, setPresetName] = useState('')
  const shape = isShapeKind(kind) || kind === 'stamp' || kind === 'callout'
  return (
    <aside className="props-panel" aria-label="Properties">
      <div className="search-panel-head">
        <h2>{annot ? `${annotLabel(kind)} properties` : `${annotLabel(kind)} tool`}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close properties" title="Close (Ctrl+E)">
          <X size={16} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <div className="props-body">
        {!annot && <p className="muted small">Nothing selected: these settings apply to new {annotLabel(kind).toLowerCase()} annotations.</p>}
        <div className="props-grid">
          <label htmlFor="prop-color">Colour</label>
          <div className="props-colour">
            <input id="prop-color" type="color" value={style.color} onChange={(e) => onStyle({ color: e.target.value })} />
            <span className="swatches">
              {colorChoices(kind).map((c) => (
                <button key={c} className={c === style.color ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => onStyle({ color: c })} aria-label={`Colour ${c}`} />
              ))}
            </span>
          </div>
          {canFill(kind) && (
            <>
              <label htmlFor="prop-fill">Fill</label>
              <div className="props-colour">
                <input id="prop-fill" type="checkbox" checked={!!style.fill} onChange={(e) => onStyle({ fill: e.target.checked ? '#fff4c2' : undefined })} aria-label="Fill on" />
                {style.fill && <input type="color" value={style.fill} onChange={(e) => onStyle({ fill: e.target.value })} aria-label="Fill colour" />}
              </div>
            </>
          )}
          <label htmlFor="prop-opacity">Opacity</label>
          <div className="props-range">
            <input
              id="prop-opacity"
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round((style.opacity ?? 1) * 100)}
              onChange={(e) => onStyle({ opacity: Number(e.target.value) / 100 })}
            />
            <span>{Math.round((style.opacity ?? 1) * 100)}%</span>
          </div>
          {shape && (
            <>
              <label htmlFor="prop-width">Line width</label>
              <select id="prop-width" value={style.lineWidth ?? 2} onChange={(e) => onStyle({ lineWidth: Number(e.target.value) })}>
                {[...new Set([0.5, ...LINE_WIDTHS, 3, 8, 12, style.lineWidth ?? 2])].sort((a, b) => a - b).map((w) => (
                  <option key={w} value={w}>
                    {w} pt
                  </option>
                ))}
              </select>
            </>
          )}
          {canDash(kind) && (
            <>
              <label htmlFor="prop-dash">Line style</label>
              <select id="prop-dash" value={style.dash ?? 'solid'} onChange={(e) => onStyle({ dash: e.target.value === 'solid' ? undefined : (e.target.value as 'dashed' | 'dotted') })}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </>
          )}
          {hasFont(kind) && (
            <>
              <label htmlFor="prop-font">Font</label>
              <select id="prop-font" value={style.fontFamily ?? 'Helvetica'} onChange={(e) => onStyle({ fontFamily: e.target.value as ToolStyle['fontFamily'] })}>
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <label htmlFor="prop-size">Font size</label>
              <select id="prop-size" value={style.fontSize ?? 12} onChange={(e) => onStyle({ fontSize: Number(e.target.value) })}>
                {[...new Set([8, 9, 10, 11, 12, 14, 16, 18, 24, 32, 48, style.fontSize ?? 12])].sort((a, b) => a - b).map((s) => (
                  <option key={s} value={s}>
                    {s} pt
                  </option>
                ))}
              </select>
            </>
          )}
          {annot && (
            <>
              <label htmlFor="prop-author">Author</label>
              <input id="prop-author" value={annot.author ?? ''} onChange={(e) => onAuthor(e.target.value)} />
              <span className="muted">Created</span>
              <span>{formatWhen(annot.created) || '—'}</span>
              <span className="muted">Modified</span>
              <span>{formatWhen(annot.modified) || '—'}</span>
            </>
          )}
        </div>
        <div className="props-actions">
          <button className="btn" onClick={onMakeDefault} title={`New ${annotLabel(kind).toLowerCase()} annotations will use this style, in every document`}>
            <Save size={14} aria-hidden /> Make default for {annotLabel(kind)}
          </button>
        </div>
        <h3>Presets</h3>
        <form
          className="props-preset-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!presetName.trim()) return
            onSavePreset(presetName.trim())
            setPresetName('')
          }}
        >
          <input aria-label="Preset name" placeholder={`Name, e.g. "Red ${annotLabel(kind).toLowerCase()}"`} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
          <button className="btn" type="submit" disabled={!presetName.trim()}>
            <Bookmark size={14} aria-hidden /> Save preset
          </button>
        </form>
        <ul className="props-presets" aria-label="Saved presets">
          {presets.map((p) => (
            <li key={p.id}>
              <button className="props-preset" onClick={() => onUsePreset(p)} title={`Use this preset (${annotLabel(p.kind as AnnotKind)} tool)`}>
                <span className="comment-swatch" style={{ background: p.style.color ?? '#888' }} aria-hidden />
                <span>{p.name}</span>
                <span className="muted small">{annotLabel(p.kind as AnnotKind)}</span>
              </button>
              <button className="icon-btn tiny" onClick={() => onDeletePreset(p.id)} aria-label={`Delete preset ${p.name}`}>
                <Trash2 size={12} aria-hidden />
              </button>
            </li>
          ))}
          {!presets.length && <li className="muted small">No presets yet.</li>}
        </ul>
      </div>
    </aside>
  )
}
