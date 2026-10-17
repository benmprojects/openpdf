import { useState } from 'react'
import { Modal } from './AppDialogs'
import { DOC_EVENTS, type DocActions, type DocEvent } from './docActions'
import type { CommonPatch } from './formDesign'
import { msg, t } from './i18n'
import { consoleText, type ConsoleLine } from './scriptConsole'

type Tri = 'keep' | 'yes' | 'no'
const triValue = (v: Tri): boolean | undefined => (v === 'keep' ? undefined : v === 'yes')

function TriSelect({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <label className="props-row">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Tri)}>
        <option value="keep">{t('Leave as it is')}</option>
        <option value="yes">{t('Yes')}</option>
        <option value="no">{t('No')}</option>
      </select>
    </label>
  )
}

/** Properties several fields share: what is left as it is stays different from field to field. */
export function CommonFieldsDialog({ count, onApply, onClose }: { count: number; onApply: (p: CommonPatch) => void; onClose: () => void }) {
  const [required, setRequired] = useState<Tri>('keep')
  const [readOnly, setReadOnly] = useState<Tri>('keep')
  const [fontSize, setFontSize] = useState('')
  const [align, setAlign] = useState<'keep' | '0' | '1' | '2'>('keep')
  const [tooltip, setTooltip] = useState('')
  const [error, setError] = useState('')

  const submit = () => {
    const patch: CommonPatch = {}
    const r = triValue(required)
    if (r !== undefined) patch.required = r
    const o = triValue(readOnly)
    if (o !== undefined) patch.readOnly = o
    if (fontSize.trim() !== '') {
      const n = Number(fontSize)
      if (!(n >= 0 && n <= 200)) return setError(t('The text size must be from 0 (automatic) to 200 points.'))
      patch.fontSize = n
    }
    if (align !== 'keep') patch.align = Number(align) as 0 | 1 | 2
    if (tooltip.trim()) patch.tooltip = tooltip.trim()
    if (!Object.keys(patch).length) return setError(t('Choose at least one property to change.'))
    onApply(patch)
  }

  return (
    <Modal title={t('Properties of {n} fields', { n: count })} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p className="muted">{t('Only what you change here is applied to every selected field. A property a kind of field does not have (alignment on a check box, say) is skipped for it.')}</p>
        <TriSelect label={t('Required')} value={required} onChange={setRequired} />
        <TriSelect label={t('Read only')} value={readOnly} onChange={setReadOnly} />
        <label className="props-row">
          <span>{t('Text size')}</span>
          <input type="number" aria-label={t('Text size')} min={0} max={200} step={1} placeholder={t('Leave as it is')} value={fontSize} onChange={(e) => setFontSize(e.target.value)} />
        </label>
        <label className="props-row">
          <span>{t('Align text')}</span>
          <select aria-label={t('Align text')} value={align} onChange={(e) => setAlign(e.target.value as typeof align)}>
            <option value="keep">{t('Leave as it is')}</option>
            <option value="0">{t('Left')}</option>
            <option value="1">{t('Centre')}</option>
            <option value="2">{t('Right')}</option>
          </select>
        </label>
        <label className="props-row">
          <span>{t('Tooltip')}</span>
          <input aria-label={t('Tooltip for every field')} placeholder={t('Leave as it is')} value={tooltip} onChange={(e) => setTooltip(e.target.value)} />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Apply')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export type EmailFormat = 'xfdf' | 'fdf' | 'xml' | 'csv'

/** E-mail form data: the values are saved as a small file, which is then shown or a message is started (see MailDialog). */
export function EmailFormDialog({ fieldCount, onSend, onClose }: { fieldCount: number; onSend: (f: EmailFormat) => void; onClose: () => void }) {
  const [format, setFormat] = useState<EmailFormat>('xfdf')
  return (
    <Modal title={t('E-mail form data')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSend(format)
        }}
      >
        <p className="muted">{t('Saves the values of the {n} fields as a small data file, then helps you send it. OpenPDF cannot attach files to a message itself: the saved file is shown in Explorer to drag into your message.', { n: fieldCount })}</p>
        <label className="props-row">
          <span>{t('Format')}</span>
          <select aria-label={t('Data format')} value={format} onChange={(e) => setFormat(e.target.value as EmailFormat)}>
            <option value="xfdf">{t('XFDF (XML)')}</option>
            <option value="fdf">{t('FDF')}</option>
            <option value="xml">{t('Plain XML')}</option>
            <option value="csv">{t('CSV')}</option>
          </select>
        </label>
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Save and continue')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const EVENT_LABEL: Record<DocEvent, string> = {
  open: msg('When the document is opened'),
  willClose: msg('Before the document is closed'),
  willSave: msg('Before the document is saved'),
  didSave: msg('After the document is saved'),
  willPrint: msg('Before the document is printed'),
  didPrint: msg('After the document is printed')
}

/** Scripts that run on events of the whole document. They run in the same sandbox as field scripts. */
export function DocActionsDialog({ initial, onSave, onClose }: { initial: DocActions; onSave: (a: DocActions) => void; onClose: () => void }) {
  const [actions, setActions] = useState<DocActions>(initial)
  return (
    <Modal title={t('Document actions')} onClose={onClose} wide>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(actions)
        }}
      >
        <p className="muted">{t('JavaScript that runs when something happens to the whole document. It runs in the same sandbox as field scripts: it can read and set form fields, print to the console and show messages, and nothing else. Leave a box empty for no action.')}</p>
        {DOC_EVENTS.map((ev) => (
          <label key={ev} className="props-row" style={{ gridTemplateColumns: '1fr' }}>
            <span>{t(EVENT_LABEL[ev])}</span>
            <textarea className="action-code" aria-label={t(EVENT_LABEL[ev])} spellCheck={false} value={actions[ev]} onChange={(e) => setActions({ ...actions, [ev]: e.target.value })} />
          </label>
        ))}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** What scripts printed, in order. Read only. */
export function ConsoleDialog({ lines, onClear, onClose }: { lines: ConsoleLine[]; onClear: () => void; onClose: () => void }) {
  return (
    <Modal title={t('Script console')} onClose={onClose} wide>
      <div className="marks-form">
        <pre className="console-log" role="log" aria-label={t('Console output')} aria-live="polite">
          {lines.length === 0 ? t('Nothing has been printed yet. Scripts print with console.println("text").') : null}
          {lines.map((l) => (
            <div key={l.id} className={l.level === 'error' ? 'console-err' : undefined}>
              {`${l.at}  [${l.source}] ${l.level === 'error' ? `${t('Error')}: ` : l.level === 'alert' ? `${t('Message')}: ` : ''}${l.text}`}
            </div>
          ))}
        </pre>
        <div className="marks-actions">
          <button type="button" disabled={!lines.length} onClick={() => void navigator.clipboard.writeText(consoleText(lines))}>
            {t('Copy')}
          </button>
          <button type="button" disabled={!lines.length} onClick={onClear}>
            {t('Clear')}
          </button>
          <span style={{ flex: 1 }} />
          <button className="primary" type="button" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Clear all signatures: confirms, and asks whether to keep how the signatures looked. */
export function ClearSignaturesDialog({ count, anyVisible, onClear, onClose }: { count: number; anyVisible: boolean; onClear: (keepLook: boolean) => void; onClose: () => void }) {
  const [keepLook, setKeepLook] = useState(false)
  return (
    <Modal title={t('Clear all signatures')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onClear(keepLook)
        }}
      >
        <p>{count === 1 ? t('Remove the 1 signature from this document?') : t('Remove all {n} signatures from this document?', { n: count })}</p>
        <p className="muted">{t('The signature fields are emptied and any certification is removed, so the document can be changed and signed again. The signatures cannot be brought back, apart from by undoing this change before you save.')}</p>
        {anyVisible && (
          <label className="inline">
            <input type="checkbox" checked={keepLook} onChange={(e) => setKeepLook(e.target.checked)} /> {t('Keep how the signatures look as part of the page (they stop being signatures)')}
          </label>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Clear signatures')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
