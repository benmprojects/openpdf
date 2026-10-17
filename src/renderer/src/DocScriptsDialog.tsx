import { useState } from 'react'
import { Modal } from './AppDialogs'
import type { DocScript } from './docScripts'
import { runScript } from './formScripts'
import { t } from './i18n'

/**
 * The document's own JavaScript: named scripts, usually functions that field scripts call. A script can be run to see
 * what it does (in the same sandbox as field scripts: no files, no network).
 */
export function DocScriptsDialog({ scripts, fileName, onSave, onClose }: { scripts: DocScript[]; fileName: string; onSave: (s: DocScript[]) => void; onClose: () => void }) {
  const [list, setList] = useState<DocScript[]>(scripts.length ? scripts.map((s) => ({ ...s })) : [{ name: 'Script1', code: '' }])
  const [at, setAt] = useState(0)
  const [out, setOut] = useState('')
  const [error, setError] = useState('')
  const cur = list[at] ?? list[0]
  const set = (patch: Partial<DocScript>) => setList(list.map((s, i) => (i === at ? { ...s, ...patch } : s)))

  const add = () => {
    let n = list.length + 1
    while (list.some((s) => s.name === `Script${n}`)) n++
    setList([...list, { name: `Script${n}`, code: '' }])
    setAt(list.length)
    setOut('')
  }
  const remove = () => {
    const next = list.filter((_, i) => i !== at)
    setList(next.length ? next : [{ name: 'Script1', code: '' }])
    setAt(Math.max(0, at - 1))
    setOut('')
  }
  const run = async () => {
    setOut(t('Running…'))
    // Every script runs together, as they do before a field script, so one can use another's functions.
    const code = list.map((s) => s.code).join('\n')
    const r = await runScript('MouseUp', code, '', [], {}, fileName)
    const lines = [...r.log, ...r.alerts.map((a) => `${t('Alert')}: ${a}`)]
    setOut(r.error ? `${t('Error')}: ${r.error}` : lines.length ? lines.join('\n') : t('The scripts ran without any output.'))
  }
  const save = () => {
    const names = list.map((s) => s.name.trim())
    if (names.some((n) => !n)) return setError(t('Every script needs a name.'))
    if (new Set(names).size !== names.length) return setError(t('Two scripts have the same name.'))
    // A single empty script means "no scripts".
    const kept = list.length === 1 && !list[0].code.trim() ? [] : list
    onSave(kept.map((s) => ({ name: s.name.trim(), code: s.code })))
  }

  return (
    <Modal title={t('Document JavaScript')} onClose={onClose} wide>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <p className="muted small">{t('Functions defined here can be called from every field script in this document. Scripts run in a sandbox that cannot reach files or the network.')}</p>
        <div className="marks-row">
          <label className="inline">
            {t('Script')}
            <select
              aria-label={t('Script')}
              value={at}
              onChange={(e) => {
                setAt(Number(e.target.value))
                setOut('')
              }}
            >
              {list.map((s, i) => (
                <option key={i} value={i}>
                  {s.name || t('(no name)')}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={add}>
            {t('Add script')}
          </button>
          <button type="button" onClick={remove}>
            {t('Remove script')}
          </button>
        </div>
        <label className="props-row">
          <span>{t('Name')}</span>
          <input aria-label={t('Script name')} value={cur.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="props-row">
          <span>{t('Code')}</span>
          <textarea aria-label={t('Script code')} rows={12} spellCheck={false} value={cur.code} onChange={(e) => set({ code: e.target.value })} style={{ fontFamily: 'Consolas, monospace', width: '100%' }} />
        </label>
        <div className="marks-row">
          <button type="button" onClick={() => void run()}>
            {t('Run')}
          </button>
        </div>
        {out && (
          <pre className="muted small" aria-label={t('Script output')} style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
            {out}
          </pre>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Save scripts')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
