import { useEffect, useState } from 'react'
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ChevronDown, ChevronUp, Eye, EyeOff, Pencil, StretchHorizontal, StretchVertical, Trash2 } from 'lucide-react'
import type { Matrix6 } from './content'
import type { ImageObject, PdfClient, TextObject } from './pdfClient'
import { bringForward, countKinds, deleteForm, hideObject, listPageObjects, sendBackward, showObject, type ObjectRef } from './contentObjectsDoc'
import type { ObjectKind, StreamObject } from './contentObjects'
import { transformImage } from './imageEdit'
import { msg, t } from './i18n'
import { alignBoxes, displayMoveToPage, distributeBoxes, type AlignMode, type Box, type Move } from './objectArrange'
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
  /** Display space to page space, for pictures and shapes. */
  toPage: Matrix6 | null
}

const KIND_LABEL: Record<ObjectKind, string> = { text: msg('Text'), image: msg('Picture'), path: msg('Shape'), form: msg('Form') }

/** Names the person gives objects last for this session: they are not saved in the file. Keyed by kind and place, so reordering keeps them. */
const nameKey = (kind: string, r: { x: number; y: number; w: number; h: number } | null): string => (r ? `${kind}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}` : kind)

/**
 * The Content pane: every object the page draws itself, in drawing order (first drawn first, so the last row is in
 * front). Pick one to see where it is, hide or show it, move it one place forward or back, rename it, or delete it.
 * Tick several pictures and shapes to align or spread them, or to delete them together.
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
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<{ key: string; draft: string } | null>(null)

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
          return { key, obj: o, label: `${t(KIND_LABEL.text)}: ${words.length > 36 ? `${words.slice(0, 36)}…` : words || '…'}`, rect: tx?.rect ?? null, text: tx, total: texts.total, toPage: null }
        }
        const src = o.kind === 'image' ? images : o.kind === 'path' ? paths : forms
        const ob = src.objects.find((x) => x.ordinal === o.typeOrdinal)
        return { key, obj: o, label: `${t(KIND_LABEL[o.kind])} ${o.typeOrdinal + 1}`, rect: ob?.rect ?? null, other: ob, total: src.total, toPage: o.kind === 'image' || o.kind === 'path' ? src.toPage : null }
      })
      setRows(out)
      setTicked((was) => new Set([...was].filter((k) => out.some((r) => r.key === k))))
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
    setTicked(new Set())
    setRenaming(null)
    onHighlight(null)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const refOf = (r: Row): ObjectRef => ({ page, kind: r.obj.kind, typeOrdinal: r.obj.typeOrdinal })
  const act = (fn: (b: Uint8Array) => Promise<Uint8Array>, done: string) => void run(fn, done)
  const nameOf = (r: Row): string => names[`${page}:${nameKey(r.obj.kind, r.rect)}`] ?? r.label

  /** Deletes one object in `bytes`. `gone` is how many objects of its kind were deleted before it in this edit (the page then has that many fewer). */
  const removeIn = async (b: Uint8Array, r: Row, gone = 0): Promise<Uint8Array> => {
    if (r.obj.kind === 'text' && r.text) {
      const tx = r.text
      const style = { font: tx.font, flags: tx.flags, weight: tx.weight, italic: tx.italic, size: tx.size, color: tx.color, matrix: tx.matrix }
      return (await replaceBlock(b, { page, ordinals: [tx.ordinal], total: r.total - gone, origins: [{ x: tx.matrix[4], y: tx.matrix[5] }] }, '', style)).bytes
    }
    if (r.obj.kind === 'image' && r.other) return transformImage(b, { page, ordinal: r.other.ordinal, total: r.total - gone, matrix: r.other.matrix }, null)
    if (r.obj.kind === 'path' && r.other) return transformPath(b, { page, ordinal: r.other.ordinal, total: r.total - gone, pageBounds: r.other.pageBounds }, null)
    return deleteForm(b, refOf(r))
  }

  const remove = (r: Row) => {
    setPicked(null)
    onHighlight(null)
    const done = r.obj.kind === 'text' ? t('Text deleted') : r.obj.kind === 'image' ? t('Image deleted') : r.obj.kind === 'path' ? t('Shape deleted') : t('Form deleted')
    act((b) => removeIn(b, r), done)
  }

  const movable = (rows ?? []).filter((r) => ticked.has(r.key) && r.rect && r.toPage && r.other)

  /** Applies display-space moves to pictures and shapes, one after another in a single edit. */
  const applyMoves = (moves: Map<string, Move>, done: string) => {
    if (!moves.size) return setProblem(t('They are already like that.'))
    setProblem(null)
    const moved = movable.filter((r) => moves.has(r.key))
    const renamed: Record<string, string> = {}
    for (const r of moved) {
      const old = names[`${page}:${nameKey(r.obj.kind, r.rect)}`]
      const m = moves.get(r.key)!
      if (old && r.rect) renamed[`${page}:${nameKey(r.obj.kind, { ...r.rect, x: r.rect.x + m.dx, y: r.rect.y + m.dy })}`] = old
    }
    setNames((n) => ({ ...n, ...renamed }))
    act(async (b) => {
      let cur = b
      for (const r of moved) {
        const change = displayMoveToPage(r.toPage!, moves.get(r.key)!)
        if (!change) throw new Error(t('That object cannot be moved.'))
        cur =
          r.obj.kind === 'image'
            ? await transformImage(cur, { page, ordinal: r.other!.ordinal, total: r.total, matrix: r.other!.matrix }, change)
            : await transformPath(cur, { page, ordinal: r.other!.ordinal, total: r.total, pageBounds: r.other!.pageBounds }, change)
      }
      return cur
    }, done)
  }

  const boxes = (): Box[] => movable.map((r) => ({ id: r.key, ...r.rect! }))
  const align = (mode: AlignMode) => applyMoves(alignBoxes(boxes(), mode), t('Objects aligned'))
  const spread = (axis: 'horizontal' | 'vertical') => applyMoves(distributeBoxes(boxes(), axis), t('Objects spread evenly'))

  const removeTicked = () => {
    const list = (rows ?? []).filter((r) => ticked.has(r.key))
    if (!list.length) return
    setPicked(null)
    setTicked(new Set())
    onHighlight(null)
    // Last drawn first, so the ordinals of the ones still to go do not change; the page has one fewer object of the kind each time.
    act(async (b) => {
      let cur = b
      const gone: Record<string, number> = {}
      for (const r of list.slice().reverse()) {
        cur = await removeIn(cur, r, gone[r.obj.kind] ?? 0)
        gone[r.obj.kind] = (gone[r.obj.kind] ?? 0) + 1
      }
      return cur
    }, t('Objects deleted'))
  }

  const commitRename = () => {
    if (!renaming) return
    const r = rows?.find((x) => x.key === renaming.key)
    if (r) {
      const k = `${page}:${nameKey(r.obj.kind, r.rect)}`
      const draft = renaming.draft.trim()
      setNames((n) => {
        const next = { ...n }
        if (draft && draft !== r.label) next[k] = draft
        else delete next[k]
        return next
      })
    }
    setRenaming(null)
  }

  const tick = (key: string) =>
    setTicked((was) => {
      const n = new Set(was)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const bar = (icon: React.ReactNode, label: string, onClick: () => void, enabled: boolean) => (
    <button type="button" className="icon" aria-label={label} title={label} disabled={!canEdit || !enabled} onClick={onClick}>
      {icon}
    </button>
  )

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
      {rows && rows.length > 0 && (
        <div className="content-bar" role="toolbar" aria-label={t('Arrange the ticked objects')}>
          {bar(<AlignStartVertical size={14} aria-hidden />, t('Align left'), () => align('left'), movable.length > 1)}
          {bar(<AlignCenterVertical size={14} aria-hidden />, t('Align centres'), () => align('centre'), movable.length > 1)}
          {bar(<AlignEndVertical size={14} aria-hidden />, t('Align right'), () => align('right'), movable.length > 1)}
          {bar(<AlignStartHorizontal size={14} aria-hidden />, t('Align tops'), () => align('top'), movable.length > 1)}
          {bar(<AlignCenterHorizontal size={14} aria-hidden />, t('Align middles'), () => align('middle'), movable.length > 1)}
          {bar(<AlignEndHorizontal size={14} aria-hidden />, t('Align bottoms'), () => align('bottom'), movable.length > 1)}
          {bar(<StretchHorizontal size={14} aria-hidden />, t('Spread across'), () => spread('horizontal'), movable.length > 2)}
          {bar(<StretchVertical size={14} aria-hidden />, t('Spread down'), () => spread('vertical'), movable.length > 2)}
          {bar(<Trash2 size={14} aria-hidden />, t('Delete the ticked objects'), removeTicked, ticked.size > 0)}
          <span className="muted">{t('{n} ticked', { n: ticked.size })}</span>
        </div>
      )}
      <ol aria-label={t('Page objects')}>
        {rows?.map((r, i) => {
          const hidden = !!r.obj.hiddenBy
          const shown = nameOf(r)
          return (
            <li key={r.key} className={`content-row${picked === r.key ? ' selected' : ''}${hidden ? ' hidden' : ''}`}>
              <input type="checkbox" aria-label={t('Tick {what}', { what: shown })} checked={ticked.has(r.key)} onChange={() => tick(r.key)} />
              {renaming?.key === r.key ? (
                <input
                  className="content-name"
                  aria-label={t('Name of {what}', { what: r.label })}
                  autoFocus
                  value={renaming.draft}
                  onChange={(e) => setRenaming({ key: r.key, draft: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="content-name"
                  aria-pressed={picked === r.key}
                  title={hidden ? t('{what} (hidden)', { what: shown }) : shown}
                  onClick={() => {
                    setPicked(r.key)
                    onHighlight(r.rect ? { page, rect: r.rect } : null)
                  }}
                  onDoubleClick={() => setRenaming({ key: r.key, draft: shown })}
                  onKeyDown={(e) => e.key === 'F2' && setRenaming({ key: r.key, draft: shown })}
                >
                  {shown}
                </button>
              )}
              <button type="button" className="icon" aria-label={t('Rename {what}', { what: shown })} title={t('Rename (names last for this session only and are not saved in the file)')} onClick={() => setRenaming({ key: r.key, draft: shown })}>
                <Pencil size={14} aria-hidden />
              </button>
              <button type="button" className="icon" aria-label={hidden ? t('Show {what}', { what: shown }) : t('Hide {what}', { what: shown })} title={hidden ? t('Show') : t('Hide')} disabled={!canEdit} onClick={() => act((b) => (hidden ? showObject(b, refOf(r)) : hideObject(b, refOf(r))), hidden ? t('Object shown') : t('Object hidden (see the Layers pane)'))}>
                {hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              </button>
              <button type="button" className="icon" aria-label={t('Send {what} backward', { what: shown })} title={t('Send backward (draw it earlier)')} disabled={!canEdit || i === 0} onClick={() => act((b) => sendBackward(b, refOf(r)), t('Moved backward'))}>
                <ChevronUp size={14} aria-hidden />
              </button>
              <button type="button" className="icon" aria-label={t('Bring {what} forward', { what: shown })} title={t('Bring forward (draw it later)')} disabled={!canEdit || i === rows.length - 1} onClick={() => act((b) => bringForward(b, refOf(r)), t('Moved forward'))}>
                <ChevronDown size={14} aria-hidden />
              </button>
              <button type="button" className="icon" aria-label={t('Delete {what}', { what: shown })} title={t('Delete')} disabled={!canEdit} onClick={() => remove(r)}>
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          )
        })}
      </ol>
      <p className="muted">{t('Forms are listed as one object each. To edit what is inside one, use Unpack forms on the Edit tab. Pictures and shapes can be aligned and spread; text is left where it is.')}</p>
    </div>
  )
}
