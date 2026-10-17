import { Bookmark, Paintbrush, Pin, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import {
  annotLabel,
  BLEND_MODES,
  blendOf,
  canBlend,
  canCloud,
  canDash,
  canFill,
  canLineEnds,
  cloudLevel,
  colorChoices,
  FONT_FAMILIES,
  formatWhen,
  hasFont,
  isLocked,
  isPrintable,
  isShapeKind,
  lineEndsOf,
  LINE_WIDTHS,
  type Annot,
  type AnnotKind,
  type BlendMode,
  type LineEnd,
  type ToolStyle
} from './annotations'
import { t } from './i18n'
import { LINE_ENDS } from './lineEnds'

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
  /** Gives a saved style to the selected comments (hidden when nothing is selected). */
  onApplyPreset?: (p: ToolPreset) => void
  /** How many comments are selected, for the label of that button. */
  selectedCount?: number
  /** Makes a saved style the default for its tool. */
  onPresetDefault?: (p: ToolPreset) => void
  /** Switches the Print and Locked flags of the selected annotation. */
  onFlags?: (patch: { printable?: boolean; locked?: boolean }) => void
  onClose: () => void
}

const endLabel = (e: LineEnd) =>
  ({ None: t('None'), OpenArrow: t('Open arrow'), ClosedArrow: t('Closed arrow'), ROpenArrow: t('Reversed open arrow'), RClosedArrow: t('Reversed closed arrow'), Circle: t('Circle'), Square: t('Square'), Diamond: t('Diamond'), Slash: t('Slash'), Butt: t('Butt') })[e]

/** Every property of the selected annotation (or the current tool), with tool defaults and saved presets. */
export function PropertiesPanel({ annot, kind, style, onStyle, onAuthor, onMakeDefault, presets, onSavePreset, onUsePreset, onDeletePreset, onApplyPreset, selectedCount = 0, onPresetDefault, onFlags, onClose }: Props) {
  const [presetName, setPresetName] = useState('')
  const shape = isShapeKind(kind) || kind === 'stamp' || kind === 'callout'
  const locked = !!annot && isLocked(annot)
  const ends = lineEndsOf({ kind, lineStart: style.lineStart, lineEnd: style.lineEnd })
  const blendLabels: Record<BlendMode, string> = { Normal: t('Normal'), Multiply: t('Multiply'), Screen: t('Screen'), Overlay: t('Overlay'), Darken: t('Darken'), Lighten: t('Lighten') }
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
        {locked && <p className="muted small">{t('This comment is locked. Untick Locked below to change it.')}</p>}
        <fieldset className="props-set" disabled={locked}>
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
          {canLineEnds(kind) && (
            <>
              <label htmlFor="prop-lstart">{t('Line start')}</label>
              <select id="prop-lstart" value={ends.start} onChange={(e) => onStyle({ lineStart: e.target.value as LineEnd })}>
                {LINE_ENDS.map((v) => (
                  <option key={v} value={v}>
                    {endLabel(v)}
                  </option>
                ))}
              </select>
              <label htmlFor="prop-lend">{t('Line end')}</label>
              <select id="prop-lend" value={ends.end} onChange={(e) => onStyle({ lineEnd: e.target.value as LineEnd })}>
                {LINE_ENDS.map((v) => (
                  <option key={v} value={v}>
                    {endLabel(v)}
                  </option>
                ))}
              </select>
            </>
          )}
          {canCloud(kind) && (
            <>
              <label htmlFor="prop-cloud">{t('Cloud border')}</label>
              <select id="prop-cloud" value={cloudLevel({ kind, cloud: style.cloud })} onChange={(e) => onStyle({ cloud: Number(e.target.value) })}>
                <option value={0}>{t('None (plain line)')}</option>
                <option value={1}>{t('Small scallops')}</option>
                <option value={2}>{t('Large scallops')}</option>
              </select>
            </>
          )}
          {canBlend(kind) && (
            <>
              <label htmlFor="prop-blend">{t('Blend mode')}</label>
              <select id="prop-blend" value={blendOf({ kind, blend: style.blend })} onChange={(e) => onStyle({ blend: e.target.value as BlendMode })}>
                {BLEND_MODES.map((b) => (
                  <option key={b} value={b}>
                    {blendLabels[b]}
                  </option>
                ))}
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
        </fieldset>
        {annot && onFlags && (
          <div className="props-flags" role="group" aria-label={t('Comment flags')}>
            <label title={t('Untick to leave this comment off the printout')}>
              <input type="checkbox" checked={isPrintable(annot)} onChange={(e) => onFlags({ printable: e.target.checked })} />
              {t('Printable')}
            </label>
            <label title={t('A locked comment cannot be moved, edited, restyled or deleted')}>
              <input type="checkbox" checked={isLocked(annot)} onChange={(e) => onFlags({ locked: e.target.checked })} />
              {t('Locked')}
            </label>
          </div>
        )}
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
              {onApplyPreset && selectedCount > 0 && (
                <button className="icon-btn tiny" onClick={() => onApplyPreset(p)} aria-label={t('Apply {name} to the selected comments', { name: p.name })} title={t('Apply to {n} selected', { n: selectedCount })}>
                  <Paintbrush size={12} aria-hidden />
                </button>
              )}
              {onPresetDefault && (
                <button className="icon-btn tiny" onClick={() => onPresetDefault(p)} aria-label={t('Make {name} the default for {tool}', { name: p.name, tool: annotLabel(p.kind as AnnotKind) })} title={t('Make this the default for the {tool} tool', { tool: annotLabel(p.kind as AnnotKind) })}>
                  <Pin size={12} aria-hidden />
                </button>
              )}
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
