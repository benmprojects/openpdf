import { useEffect, useRef, useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'
import { cleanFileName } from '../../shared/fileNames'
import { Frame } from './PageOpsDialogs'
import { PAPER_MM, pagesWord, type PaperKind } from './pageDialogLogic'
import { newDocumentSize } from './newDocument'

/** A question that needs a yes: used before anything that throws work away or changes the file on disk. */
export function ConfirmDialog({
  title,
  message,
  detail,
  confirm,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  message: string
  detail?: string
  confirm: string
  /** Shown as the main action of a risky step: the safe answer (Cancel) is focused. */
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  // The modal puts focus on its first control after this runs, so the safe answer takes it back a moment later.
  useEffect(() => {
    if (!danger) return
    const id = window.setTimeout(() => cancel.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [danger])
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="pod"
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm()
        }}
      >
        <p>{message}</p>
        {detail && <p className="pod-hint">{detail}</p>}
        <div className="pod-actions">
          <button type="submit" className={danger ? undefined : 'primary'}>
            {confirm}
          </button>
          <button ref={cancel} type="button" className={danger ? 'primary' : undefined} onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Rename the file on disk, in its own folder. */
export function RenameDialog({ fileName, onRename, onClose }: { fileName: string; onRename: (newName: string) => void; onClose: () => void }) {
  const [text, setText] = useState(fileName.replace(/\.pdf$/i, ''))
  const clean = cleanFileName(text)
  const same = clean.name.toLowerCase() === fileName.toLowerCase() && clean.name === fileName
  const error = clean.error ? t(clean.error) : same ? t('That is the name it already has.') : null
  return (
    <Frame
      title={t('Rename file')}
      ok={t('Rename')}
      error={error}
      summary={t('The file {from} will be renamed {to}. It stays in the same folder.', { from: fileName, to: clean.name })}
      onClose={onClose}
      onOk={() => onRename(clean.name)}
    >
      <div className="pod-field">
        <label>
          <span>{t('New name')}</span>
          <input aria-label={t('New file name')} autoFocus value={text} onChange={(e) => setText(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <span className="pod-hint">.pdf</span>
      </div>
    </Frame>
  )
}

/** A new blank document: page size, orientation and number of pages. */
export function NewDocumentDialog({ onCreate, onClose }: { onCreate: (size: { width: number; height: number }, count: number) => void; onClose: () => void }) {
  const [paper, setPaper] = useState<Exclude<PaperKind, 'same'>>('a4')
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait')
  const [custom, setCustom] = useState({ w: '210', h: '297' })
  const [count, setCount] = useState('1')
  const size = newDocumentSize(paper, orient, { w: Number(custom.w), h: Number(custom.h) })
  const n = Number(count)
  const error = size.error ? t(size.error) : !Number.isInteger(n) || n < 1 || n > 500 ? t('Enter a number of pages from 1 to 500.') : null
  const mm = (pt: number) => Math.round((pt * 25.4) / 72)
  return (
    <Frame
      title={t('New document')}
      ok={t('Create')}
      error={error}
      summary={t('A new document of {pages}, each {w} x {h} mm, will open. Save it to keep it.', { pages: pagesWord(Number.isInteger(n) ? n : 0), w: mm(size.width), h: mm(size.height) })}
      onClose={onClose}
      onOk={() => onCreate({ width: size.width, height: size.height }, n)}
    >
      <div className="pod-grid">
        <label>
          <span>{t('Page size')}</span>
          <select aria-label={t('Page size')} value={paper} onChange={(e) => setPaper(e.target.value as Exclude<PaperKind, 'same'>)}>
            <option value="a4">A4</option>
            <option value="a3">A3</option>
            <option value="letter">Letter</option>
            <option value="legal">Legal</option>
            <option value="custom">{t('Custom (mm)')}</option>
          </select>
        </label>
        {paper === 'custom' ? (
          <div className="pod-field">
            <input aria-label={t('Width (mm)')} inputMode="decimal" value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value })} />
            <span>×</span>
            <input aria-label={t('Height (mm)')} inputMode="decimal" value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value })} />
            <span className="pod-hint">mm</span>
          </div>
        ) : (
          <span className="pod-hint">
            {PAPER_MM[paper].w} × {PAPER_MM[paper].h} mm
          </span>
        )}
        <label>
          <span>{t('Orientation')}</span>
          <select aria-label={t('Orientation')} value={orient} onChange={(e) => setOrient(e.target.value as 'portrait' | 'landscape')}>
            <option value="portrait">{t('Portrait')}</option>
            <option value="landscape">{t('Landscape')}</option>
          </select>
        </label>
        <label>
          <span>{t('Number of pages')}</span>
          <input aria-label={t('Number of pages in the new document')} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
      </div>
    </Frame>
  )
}
