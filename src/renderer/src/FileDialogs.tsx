import { useState, type FormEvent } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'

/** Open from URL: an https address of a PDF, downloaded by the main process. */
export function OpenUrlDialog({ onOpen, onClose }: { onOpen: (file: { name: string; data: Uint8Array }) => void; onClose: () => void }) {
  const [address, setAddress] = useState('https://')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await window.openpdf.openUrl(address)
      if (r.ok) {
        onOpen({ name: r.name, data: r.data })
        onClose()
      } else setError(r.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={t('Open from URL')} onClose={onClose}>
      <form className="marks-form" onSubmit={(e) => void submit(e)}>
        <label className="props-row" style={{ gridTemplateColumns: '90px 1fr' }}>
          <span>{t('Web address')}</span>
          <input aria-label={t('Web address')} value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} autoFocus style={{ minWidth: 360 }} />
        </label>
        <p className="muted small">{t('Only https:// addresses are opened. The file is downloaded to a temporary place (up to 250 MB) and opens as an unsaved document; Save asks where to keep it.')}</p>
        {busy && <p role="status">{t('Downloading…')}</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit" disabled={busy || !address.trim()}>
            {t('Open')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Send by e-mail. A program cannot attach a file to a message through Windows without native mail code, and a mailto:
 * link cannot attach at all. So this does not pretend: the saved file is shown in Explorer to attach by hand, or a
 * message is started without it.
 */
export function MailDialog({ name, path, onClose }: { name: string; path: string; onClose: () => void }) {
  const [done, setDone] = useState<'reveal' | 'compose' | null>(null)
  const [error, setError] = useState('')
  const run = async (mode: 'reveal' | 'compose') => {
    setError('')
    try {
      await window.openpdf.sendMail(path, mode)
      setDone(mode)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Modal title={t('Send by e-mail')} onClose={onClose}>
      <div className="marks-form">
        <p>{t('{name} is saved.', { name })}</p>
        <p className="muted">{t('OpenPDF cannot attach a file to an e-mail message itself. Show the file in Explorer, then drag it into a new message (or right-click it, choose Send to, then Mail recipient).')}</p>
        {done === 'reveal' && <p role="status">{t('The file is selected in Explorer. It has not been attached to anything.')}</p>}
        {done === 'compose' && <p role="status">{t('A new message was started in your mail program. The file is not attached: attach it from where it is saved.')}</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={() => void run('compose')}>
            {t('Start a message without the file')}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t('Close')}
          </button>
          <button className="primary" type="button" onClick={() => void run('reveal')}>
            {t('Show in Explorer')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
