import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Trash2 } from 'lucide-react'
import type { ImageObject, PdfClient, TextObject } from './pdfClient'
import { bringForward, countKinds, deleteForm, hideObject, listPageObjects, sendBackward, showObject, type ObjectRef } from './contentObjectsDoc'
import type { ObjectKind, StreamObject } from './contentObjects'
import { transformImage } from './imageEdit'
import { msg, t } from './i18n'
import { transformPath } from './pathEdit'
import { replaceBlock } from './textEdit'

interface Row {
  key: string
  obj: StreamObject
  label: string
  rect: { x: number; y: number; w: number; h: number } | null
  text?: TextObject
  other?: ImageObject
  /** PDFium's count of this kind on the page. */
  total: number
}

const KIND_LABEL: Record<ObjectKind, string> = { text: msg('Text'), image: msg('Picture'), path: msg('Shape'), form: msg('Form') }

/**
 * The Content pane: every object the page draws itself, in drawing order (first drawn first, so the last row is in
 * front). Pick one to see where it is, hide or show it, move it one place forward or back, or delete it.
 */
export function ContentPane({
  client,
  bytes,
  ready,
  page,
  canEdit,
  run,
  onHighlight
}: {
  client: PdfClient
  bytes: Uint8Array
  /** The viewer has read the same file as `bytes`. */
  ready: boolean
  /** Zero-based page. */
  page: number
  canEdit: boolean
  run: (fn: (base: Uint8Array) => Promise<Uint8Array | null>, done?: string) => Promise<void>
  onHighlight: (h: { page: number; rect: { x: number; y: number; w: number; h: number } } | null) => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    let live = true
    setProblem(null)
    ;(async () => {
      const [list, texts, images, paths, forms] = await Promise.all([listPageObjects(bytes, page), client.textObjects(page), client.imageObjects(page), client.pathObjects(page), client.formObjects(page)])
      if (!live) return
      const mine = countKinds(list)
      if (mine.text !== texts.total || mine.image !== images.total || mine.path !== paths.total || mine.form !== forms.total) {
        setRows([])
        setProblem(t('This page’s content could not be matched with how it is drawn, so its objects are not listed.'))
        return
      }
      const out: Row[] = list.map((o) => {
        const key = `${o.kind}-${o.typeOrdinal}`
        if (o.kind === 'text') {
          const tx = texts.objects.find((x) => x.ordinal === o.typeOrdinal)
          const words = (tx?.text ?? '').replace(/\s+/g, ' ').trim()
          return { key, obj: o, label: `${t(KIND_LABEL.text)}: ${words.length > 36 ? `${words.slice(0, 36)}…` : words || '…'}`, rect: tx?.rect ?? null, text: tx, total: texts.total }
        }
        const src = o.kind === 'image' ? images : o.kind === 'path' ? paths : forms
        const ob = src.objects.find((x) => x.ordinal === o.typeOrdinal)
        return { key, obj: o, label: `${t(KIND_LABEL[o.kind])} ${o.typeOrdinal + 1}`, rect: ob?.rect ?? null, other: ob, total: src.total }
      })
      setRows(out)
    })().catch((e) => {
      if (!live) return
      setRows([])
      setProblem(e instanceof Error ? e.message : String(e))
    })
    return () => {
      live = false
    }
  }, [client, bytes, page, ready])

  useEffect(() => {
    setPicked(null)
    onHighlight(null)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const refOf = (r: Row): ObjectRef => ({ page, kind: r.obj.kind, typeOrdinal: r.obj.typeOrdinal })
  const act = (fn: (b: Uint8Array) => Promise<Uint8Array>, done: string) => void run(fn, done)

  const remove = (r: Row) => {
    setPicked(null)
    onHighlight(null)
    if (r.obj.kind === 'text' && r.text) {
      const tx = r.text
      const style = { font: tx.font, flags: tx.flags, weight: tx.weight, italic: tx.italic, size: tx.size, color: tx.color, matrix: tx.matrix }
      act(async (b) => (await replaceBlock(b, { page, ordinals: [tx.ordinal], total: r.total, origins: [{ x: tx.matrix[4], y: tx.matrix[5] }] }, '', style)).bytes, t('Text deleted'))
    } else if (r.obj.kind === 'image' && r.other) {
      const o = r.other
      act((b) => transformImage(b, { page, ordinal: o.ordinal, total: r.total, matrix: o.matrix }, null), t('Image deleted'))
    } else if (r.obj.kind === 'path' && r.other) {
      const o = r.other
      act((b) => transformPath(b, { page, ordinal: o.ordinal, total: r.total, pageBounds: o.pageBounds }, null), t('Shape deleted'))
    } else if (r.obj.kind === 'form') act((b) => deleteForm(b, refOf(r)), t('Form deleted'))
  }

  return (
    <div className="content-pane" aria-label={t('Content')}>
      <p className="muted">{t('Objects on page {page}, first drawn at the top; the last row is in front.', { page: page + 1 })}</p>
      {!ready && <p className="muted">{t('Waiting for the document…')}</p>}
      {problem && (
        <p className="muted" role="alert">
          {problem}
        </p>
      )}
      {rows && rows.length === 0 && !problem && <p className="muted">{t('This page draws no text, pictures, shapes or forms of its own.')}</p>}
      <ol aria-label={t('Page objects')}>
        {rows?.map((r, i) => {
          const hidden = !!r.obj.hiddenBy
          return (
            <li key={r.key} className={`content-row${picked === r.key ? ' selected' : ''}${hidden ? ' hidden' : ''}`}>
              <button
                type="button"
                className="content-name"
                aria-pressed={picked === r.key}
                title={hidden ? t('{what} (hidden)', { what: r.label }) : r.label}
                onClick={() => {
                  setPicked(r.key)
                  onHighlight(r.rect ? { page, rect: r.rect } : null)
                }}
              >
                {r.label}
              </button>
              <button type="button" className="icon" aria-label={hidden ? t('Show {what}', { what: r.label }) : t('Hide {what}', { what: r.label })} title={hidden ? t('Show') : t('Hide')} disabled={!canEdit} onClick={() => act((b) => (hidden ? showObject(b, refOf(r)) : hideObject(b, refOf(r))), hidden ? t('Object shown') : t('Object hidden (see the Layers pane)'))}>
                {hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              </button>
              <button type="button" className="icon" aria-label={t('Send {what} backward', { what: r.label })} title={t('Send backward (draw it earlier)')} disabled={!canEdit || i === 0} onClick={() => act((b) => sendBackward(b, refOf(r)), t('Moved backward'))}>
                <ChevronUp size={14} aria-hidden />
              </button>
              <button type="button" className="icon" aria-label={t('Bring {what} forward', { what: r.label })} title={t('Bring forward (draw it later)')} disabled={!canEdit || i === rows.length - 1} onClick={() => act((b) => bringForward(b, refOf(r)), t('Moved forward'))}>
                <ChevronDown size={14} aria-hidden />
              </button>
              <button type="button" className="icon" aria-label={t('Delete {what}', { what: r.label })} title={t('Delete')} disabled={!canEdit} onClick={() => remove(r)}>
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          )
        })}
      </ol>
      <p className="muted">{t('Forms are listed as one object each; what is inside them cannot be edited here.')}</p>
    </div>
  )
}
