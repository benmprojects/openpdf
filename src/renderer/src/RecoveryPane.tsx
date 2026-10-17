import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'
import type { RecoveryEntry } from '../../preload'
import { PdfClient } from './pdfClient'
import { formatDateTime, t } from './i18n'

interface Props {
  /** Snapshots whose key starts with this belong to documents open in this window right now. */
  liveKeyPrefix: string
  /** Open a snapshot as a document of its own (unsaved), as a recovered one is. */
  onOpen: (entry: RecoveryEntry, data: Uint8Array) => void
}

const PREVIEW_WIDTH = 160

/** One snapshot's first page, drawn on demand with a private PDFium worker that is stopped again afterwards. */
function Preview({ keyName }: { keyName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<{ pages: number } | 'failed' | null>(null)
  useEffect(() => {
    let cancelled = false
    const client = new PdfClient()
    void (async () => {
      try {
        const data = await window.openpdf.recoveryRead(keyName)
        const pages = await client.load(data)
        if (cancelled || !pages.length) return setState(pages.length ? null : 'failed')
        const dpr = window.devicePixelRatio || 1
        const out = await client.render(0, (PREVIEW_WIDTH * dpr) / pages[0].width)
        const cv = canvas.current
        if (cancelled || !cv) return
        cv.width = out.width
        cv.height = out.height
        cv.style.width = `${out.width / dpr}px`
        cv.style.height = `${out.height / dpr}px`
        cv.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
        setState({ pages: pages.length })
      } catch {
        if (!cancelled) setState('failed')
      }
    })()
    return () => {
      cancelled = true
      client.dispose()
    }
  }, [keyName])
  return (
    <div className="recovery-preview">
      {state === 'failed' ? (
        <p className="error-text small">{t('This snapshot could not be read.')}</p>
      ) : (
        <>
          <canvas ref={canvas} aria-label={t('First page of the snapshot')} />
          {state && state !== null && <p className="muted small">{t('{n} pages', { n: state.pages })}</p>}
        </>
      )}
    </div>
  )
}

/**
 * The Recovery pane: the snapshots of unsaved work that OpenPDF keeps, each with its time, a preview of its first page,
 * and commands to open it as a document or delete it. Snapshots of documents still open here are listed but kept.
 */
export function RecoveryPane({ liveKeyPrefix, onOpen }: Props) {
  const [list, setList] = useState<RecoveryEntry[] | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(() => {
    window.openpdf.recoveryList().then(setList, () => setList([]))
  }, [])
  useEffect(() => {
    refresh()
    // Snapshots are written every few minutes by open documents: look again now and then while the pane is open.
    const timer = window.setInterval(refresh, 15_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const open = async (e: RecoveryEntry) => {
    try {
      onOpen(e, await window.openpdf.recoveryRead(e.key))
      await window.openpdf.recoveryClear(e.key)
      setMessage(null)
      refresh()
    } catch {
      setMessage(t('That snapshot could not be opened.'))
    }
  }
  const remove = async (e: RecoveryEntry) => {
    await window.openpdf.recoveryClear(e.key).catch(() => undefined)
    if (previewKey === e.key) setPreviewKey(null)
    refresh()
  }

  return (
    <div className="recovery-pane">
      <p className="muted small" style={{ margin: '8px 10px 0' }}>
        {t('OpenPDF saves a snapshot of unsaved work every few minutes. After a crash the snapshots are offered back; you can also open or delete them here.')}
      </p>
      {message && (
        <p role="alert" className="error-text small" style={{ margin: '4px 10px' }}>
          {message}
        </p>
      )}
      {list === null ? (
        <p className="muted small" style={{ margin: 10 }}>
          {t('Looking for snapshots…')}
        </p>
      ) : !list.length ? (
        <p className="muted small" style={{ margin: 10 }}>
          {t('There are no snapshots. They appear here once a document has unsaved changes for a few minutes.')}
        </p>
      ) : (
        <ul className="recovery-list" aria-label={t('Recovery snapshots')}>
          {list.map((e) => {
            const live = e.key.startsWith(`${liveKeyPrefix}-`)
            return (
              <li key={e.key}>
                <div className="recovery-row">
                  <button type="button" className="recovery-name" onClick={() => setPreviewKey(previewKey === e.key ? null : e.key)} aria-expanded={previewKey === e.key} title={t('Show or hide a preview')}>
                    <span className="dest-name">{e.name}</span>
                    <span className="muted small">
                      {formatDateTime(new Date(e.time))}
                      {live ? ` · ${t('open now')}` : ''}
                    </span>
                  </button>
                  <span className="dest-actions">
                    <button type="button" className="icon-btn" aria-label={t('Open {name}', { name: e.name })} title={live ? t('This document is open in this window') : t('Open as an unsaved document')} disabled={live} onClick={() => void open(e)}>
                      <FolderOpen size={14} strokeWidth={1.8} aria-hidden />
                    </button>
                    <button type="button" className="icon-btn" aria-label={t('Delete the snapshot of {name}', { name: e.name })} title={live ? t('This document is open in this window') : t('Delete this snapshot')} disabled={live} onClick={() => void remove(e)}>
                      <Trash2 size={14} strokeWidth={1.8} aria-hidden />
                    </button>
                  </span>
                </div>
                {previewKey === e.key && <Preview keyName={e.key} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
