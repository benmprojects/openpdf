import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ImageStamp } from '../../preload'
import { imageStampSize, stampInfoLine, stampSize, type Annot, type AnnotKind } from './annotations'
import { t } from './i18n'
import type { DocContext } from './pageDialogLogic'
import { PdfClient } from './pdfClient'
import { encodeRotatedPng } from './print'
import { ImageStampDialog, StampPagesDialog, TextStampDialog } from './StampDialogs'
import { isSignatureCategory } from './signatureLogic'
import { dataUrlBytes, trimTransparent, whiteToAlpha } from './stampImage'
import {
  BUILTIN_STAMPS,
  CAT_MINE,
  categoriesOf,
  clampOpacity,
  DEFAULT_OPTS,
  emptyMeta,
  expandStamp,
  fitAspect,
  normAngle,
  parseCollection,
  parseMeta,
  pushRecent,
  rotatedBounds,
  serialiseCollection,
  takeNumbers,
  uniqueName,
  usesNumber,
  type StampDef,
  type StampMeta,
  type StampOpts
} from './stampLogic'
import type { NewStampKind } from './StampPicker'

const IMG = 'img:'
const imageDef = (s: ImageStamp): StampDef => ({
  id: IMG + s.id,
  name: s.name,
  category: s.category || CAT_MINE,
  kind: 'image',
  title: '',
  detail: '',
  color: '#000000',
  image: { dataUrl: s.dataUrl, width: s.width, height: s.height }
})

function bytesToDataUrl(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
  })
}

type Dialog =
  | { kind: 'text'; initial: StampDef | null }
  | { kind: 'image'; png: Uint8Array; preview: string; name: string; rgba?: { data: Uint8Array; w: number; h: number } }
  | { kind: 'rename'; def: StampDef }
  | { kind: 'arm'; def: StampDef }
  | { kind: 'copy'; annot: Annot }

interface Deps {
  author: string
  /** Settings > Identity, for the {initials}, {organisation}, {email} and {title} fields. */
  identity?: { initials?: string; organisation?: string; email?: string; title?: string }
  pages: { width: number; height: number }[]
  ctx: DocContext
  commit: (fn: (list: Annot[]) => Annot[]) => void
  newAnnot: (kind: AnnotKind, page: number, rects: Annot['rects'], text?: string) => Annot
  select: (id: number | null) => void
  setTool: (tool: 'select' | 'stamp' | 'snapshot') => void
  notify: (n: { kind: 'error' | 'info'; text: string }) => void
  /** The selected annotation, if one. */
  selected: Annot | null
  /** Changes one annotation (the caller records the edit and takes over drawing it from PDFium). */
  update: (id: number, fn: (a: Annot) => Annot) => void
}

/**
 * Everything about stamps that is not drawing: the palette's contents (built-in, text and image stamps), recently used,
 * numbering, placement options, making stamps from pictures, PDF pages, snapshots and the clipboard, collection
 * import and export, and placing a stamp on one or several pages.
 */
export function useStamps(deps: Deps) {
  const live = useRef(deps)
  live.current = deps
  const [images, setImages] = useState<ImageStamp[]>([])
  const [meta, setMeta] = useState<StampMeta>(emptyMeta)
  const metaRef = useRef(meta)
  metaRef.current = meta
  const [choice, setChoice] = useState<StampDef>(BUILTIN_STAMPS[0])
  const [dated, setDated] = useState(false)
  const [opts, setOpts] = useState<StampOpts>(DEFAULT_OPTS)
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const choiceRef = useRef(choice)
  choiceRef.current = choice
  const datedRef = useRef(dated)
  datedRef.current = dated
  const optsRef = useRef(opts)
  optsRef.current = opts
  /** Pages chosen with "Place on several pages": the next click puts the stamp on all of them. */
  const armedPages = useRef<number[] | null>(null)
  const snapshotForStamp = useRef(false)

  const refreshImages = useCallback(async () => setImages(await window.openpdf.listStamps()), [])
  useEffect(() => {
    void refreshImages().catch(() => {})
    window.openpdf.readStampMeta().then((j) => setMeta(parseMeta(j))).catch(() => {})
  }, [refreshImages])

  const stamps = useMemo(() => [...BUILTIN_STAMPS, ...meta.texts, ...images.map(imageDef)], [meta.texts, images])
  const categories = useMemo(() => categoriesOf(stamps), [stamps])

  const saveMeta = useCallback((next: StampMeta) => {
    setMeta(next)
    window.openpdf.writeStampMeta(JSON.stringify(next)).catch(() => {})
  }, [])

  /** Places a stamp at (x, y) on page `page` (and on any pages chosen beforehand). `box` is a dragged size. */
  const place = useCallback(async (page: number, x: number, y: number, box?: { w: number; h: number }) => {
    const d = live.current
    const def = choiceRef.current
    const o = optsRef.current
    const targets = armedPages.current ?? [page]
    armedPages.current = null
    // The numbers and recent list live on disk so that two open documents share one sequence.
    const raw = await window.openpdf.readStampMeta().catch(() => null)
    const fresh = raw ? parseMeta(raw) : metaRef.current
    let counters = fresh.counters
    let numbers: (string | undefined)[] = targets.map(() => undefined)
    if (def.kind === 'text' && usesNumber(def.title, def.detail)) {
      const r = takeNumbers(counters, def, targets.length)
      numbers = r.numbers
      counters = r.counters
    }
    const now = new Date()
    const made: Annot[] = []
    targets.forEach((pg, i) => {
      const size = d.pages[pg]
      if (!size) return
      let title = def.title
      let info = ''
      let base: { w: number; h: number }
      if (def.kind === 'image' && def.image) base = imageStampSize(def.image.width, def.image.height)
      else {
        const ex = expandStamp(def, { author: d.author, identity: d.identity, now, number: numbers[i] })
        title = ex.title || def.name
        info = ex.detail || (datedRef.current ? stampInfoLine(d.author, now) : '')
        base = stampSize(title, info || undefined)
      }
      let { w, h } = base
      if (box && box.w >= 8 && box.h >= 8) ({ w, h } = o.keepAspect ? fitAspect(box, base.w / base.h) : box)
      w = Math.max(8, w)
      h = Math.max(8, h)
      const angle = normAngle(o.angle)
      const turned = rotatedBounds({ x: 0, y: 0, w, h }, angle)
      // A dragged box starts at the drag's corner; a click puts the stamp's centre on the click.
      let cx = box ? x + w / 2 : x
      let cy = box ? y + h / 2 : y
      cx = Math.max(turned.w / 2, Math.min(size.width - turned.w / 2, cx))
      cy = Math.max(turned.h / 2, Math.min(size.height - turned.h / 2, cy))
      const a = d.newAnnot('stamp', pg, [{ x: cx - w / 2, y: cy - h / 2, w, h }], def.kind === 'image' ? def.name : title)
      a.lineWidth = 2
      if (def.kind === 'image' && def.image) a.image = def.image.dataUrl
      else a.color = def.color
      if (def.kind === 'image' && isSignatureCategory(def.category)) a.signature = true
      if (info) a.stampInfo = info
      if (angle) a.angle = angle
      if (o.opacity < 1) a.opacity = clampOpacity(o.opacity)
      made.push(a)
    })
    if (!made.length) return
    d.commit((list) => [...list, ...made])
    d.select((made.find((a) => a.page === page) ?? made[0]).id)
    d.setTool('select')
    saveMeta({ texts: fresh.texts, recent: pushRecent(fresh.recent, def.id), counters })
    if (made.length > 1) d.notify({ kind: 'info', text: t('Stamp placed on {n} pages.', { n: made.length }) })
  }, [saveMeta])

  /** Choose a stamp: it arms the stamp tool, so the next click places a new one. */
  const pick = useCallback((def: StampDef) => {
    setChoice(def)
    setOpen(false)
    live.current.setTool('stamp')
  }, [])

  // ---- Making stamps ------------------------------------------------------------------------------------
  const openImage = async (png: Uint8Array, name: string, rgba?: { data: Uint8Array; w: number; h: number }) => {
    setOpen(false)
    setDialog({ kind: 'image', png, preview: await bytesToDataUrl(png), name, rgba })
  }

  const fromPdf = async () => {
    const file = await window.openpdf.pickFile({ name: 'PDF', ext: ['pdf'] })
    if (!file) return
    const c = new PdfClient()
    try {
      const sizes = await c.load(file.data)
      const s = Math.min(4, 900 / Math.max(1, sizes[0].width, sizes[0].height))
      const out = await c.render(0, s)
      const rgba = new Uint8Array(out.data)
      await openImage(await encodeRotatedPng(out.width, out.height, rgba, 0), file.name.replace(/\.pdf$/i, ''), { data: rgba, w: out.width, h: out.height })
    } catch (e) {
      live.current.notify({ kind: 'error', text: `${t('Could not read that PDF')}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      c.dispose()
    }
  }

  const fromClipboard = async () => {
    const png = await window.openpdf.clipboardImage()
    if (!png) {
      live.current.notify({ kind: 'error', text: t('There is no picture on the clipboard.') })
      return
    }
    await openImage(png, t('Clipboard stamp'))
  }

  const newStamp = (kind: NewStampKind) => {
    if (kind === 'text') {
      setOpen(false)
      setDialog({ kind: 'text', initial: null })
    } else if (kind === 'picture') {
      void (async () => {
        const res = await window.openpdf.addStamps(CAT_MINE)
        await refreshImages()
        if (res.refused.length) live.current.notify({ kind: 'error', text: `Not added (PNG or JPEG up to 8 MB only): ${res.refused.join(', ')}` })
      })()
    } else if (kind === 'pdf') {
      setOpen(false)
      void fromPdf()
    } else if (kind === 'clipboard') void fromClipboard()
    else {
      setOpen(false)
      snapshotForStamp.current = true
      live.current.setTool('snapshot')
      live.current.notify({ kind: 'info', text: t('Drag a box around the area to use as a stamp.') })
    }
  }

  /** Called by the snapshot tool with its picture: true when the picture is for a stamp (so it is not copied). */
  const captureSnapshot = (png: Uint8Array): boolean => {
    if (!snapshotForStamp.current) return false
    snapshotForStamp.current = false
    live.current.setTool('select')
    void openImage(png, t('Snapshot stamp'))
    return true
  }
  const cancelCapture = () => {
    snapshotForStamp.current = false
  }

  const saveImage = async (d: Extract<Dialog, { kind: 'image' }>, name: string, category: string, transparent: boolean) => {
    setDialog(null)
    try {
      let data = d.png
      if (transparent && d.rgba) {
        const cut = trimTransparent(whiteToAlpha(d.rgba.data), d.rgba.w, d.rgba.h)
        data = await encodeRotatedPng(cut.w, cut.h, cut.data, 0)
      }
      const taken = images.filter((s) => s.category === category).map((s) => s.name)
      const res = await window.openpdf.addStampData([{ name: uniqueName(name, taken), category, data }])
      await refreshImages()
      if (res.refused.length) live.current.notify({ kind: 'error', text: t('That picture could not be used (PNG or JPEG up to 8 MB).') })
      else if (res.added[0]) setChoice(imageDef(res.added[0]))
    } catch (e) {
      live.current.notify({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const saveText = (def: Omit<StampDef, 'id'> & { id?: string }) => {
    setDialog(null)
    const id = def.id ?? `text:${crypto.randomUUID()}`
    const taken = meta.texts.filter((s) => s.id !== id && s.category === def.category).map((s) => s.name)
    const full: StampDef = { ...def, id, name: uniqueName(def.name, taken), builtin: undefined }
    const texts = meta.texts.some((s) => s.id === id) ? meta.texts.map((s) => (s.id === id ? full : s)) : [...meta.texts, full]
    // "Next number" in the dialog sets where the numbering continues.
    const counters = usesNumber(full.title, full.detail) ? { ...meta.counters, [id]: full.numberStart ?? 1 } : meta.counters
    saveMeta({ ...meta, texts, counters })
    setChoice(full)
  }

  const edit = (s: StampDef) => {
    setOpen(false)
    setDialog(s.kind === 'image' ? { kind: 'rename', def: s } : { kind: 'text', initial: s })
  }

  const remove = async (s: StampDef) => {
    if (s.kind === 'image') {
      await window.openpdf.removeStamp(s.id.slice(IMG.length))
      await refreshImages()
    } else saveMeta({ ...meta, texts: meta.texts.filter((x) => x.id !== s.id), recent: meta.recent.filter((r) => r !== s.id) })
    if (choice.id === s.id) setChoice(BUILTIN_STAMPS[0])
  }

  // ---- Collections --------------------------------------------------------------------------------------
  const exportCollection = async () => {
    const mine = [...meta.texts, ...images.map(imageDef)]
    if (!mine.length) {
      live.current.notify({ kind: 'error', text: t('You have no stamps of your own to export yet.') })
      return
    }
    const path = await window.openpdf.saveText('My stamps.opstamps', serialiseCollection(mine), { name: 'OpenPDF stamp collection', ext: 'opstamps' })
    if (path) live.current.notify({ kind: 'info', text: t('Saved {n} stamps to {path}', { n: mine.length, path }) })
  }

  const importCollection = async () => {
    const file = await window.openpdf.pickFile({ name: 'OpenPDF stamp collection', ext: ['opstamps', 'json'] })
    if (!file) return
    try {
      const { stamps: list, skipped } = parseCollection(new TextDecoder().decode(file.data))
      const fresh = parseMeta(await window.openpdf.readStampMeta().catch(() => null))
      const texts = [...fresh.texts]
      const pics: { name: string; category: string; data: Uint8Array }[] = []
      for (const s of list) {
        if (s.kind === 'text') {
          const taken = [...texts, ...BUILTIN_STAMPS].filter((x) => x.category === s.category).map((x) => x.name)
          texts.push({ ...s, id: `text:${crypto.randomUUID()}`, name: uniqueName(s.name, taken) })
        } else {
          const data = s.image && dataUrlBytes(s.image.dataUrl)
          if (data) pics.push({ name: s.name, category: s.category, data })
        }
      }
      const res = pics.length ? await window.openpdf.addStampData(pics) : { added: [], refused: [] as string[] }
      saveMeta({ ...fresh, texts })
      await refreshImages()
      const bad = skipped + res.refused.length
      live.current.notify({
        kind: bad ? 'error' : 'info',
        text: t('Added {n} stamps from {name}.', { n: texts.length - fresh.texts.length + res.added.length, name: file.name }) + (bad ? ` ${t('{n} could not be used.', { n: bad })}` : '')
      })
    } catch (e) {
      live.current.notify({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  // ---- Several pages ------------------------------------------------------------------------------------
  /** Copies the selected stamp to the chosen pages, in the same place. */
  const copySelected = () => {
    const sel = live.current.selected
    if (sel?.kind === 'stamp') setDialog({ kind: 'copy', annot: sel })
  }

  const dialogs: ReactNode = (() => {
    if (!dialog) return null
    const close = () => setDialog(null)
    switch (dialog.kind) {
      case 'text':
        return <TextStampDialog initial={dialog.initial} categories={categories} author={deps.author} counters={meta.counters} onSave={saveText} onCancel={close} />
      case 'image':
        return (
          <ImageStampDialog
            title={t('New stamp from a picture')}
            initialName={dialog.name}
            initialCategory={CAT_MINE}
            image={dialog.preview}
            categories={categories}
            ok={t('Save')}
            offerTransparent={!!dialog.rgba}
            onSave={(n, c, tr) => void saveImage(dialog, n, c, tr)}
            onCancel={close}
          />
        )
      case 'rename':
        return (
          <ImageStampDialog
            title={t('Rename stamp')}
            initialName={dialog.def.name}
            initialCategory={dialog.def.category}
            image={dialog.def.image?.dataUrl ?? null}
            categories={categories}
            ok={t('Save')}
            onSave={(n, c) => {
              close()
              void window.openpdf.updateStamp(dialog.def.id.slice(IMG.length), { name: n, category: c }).then(refreshImages)
            }}
            onCancel={close}
          />
        )
      case 'arm':
        return (
          <StampPagesDialog
            ctx={deps.ctx}
            heading={t('Place stamp on several pages')}
            onCancel={close}
            onSubmit={(pages) => {
              close()
              armedPages.current = pages
              setChoice(dialog.def)
              deps.setTool('stamp')
              deps.notify({ kind: 'info', text: t('Click where the stamp should go. It will be placed on {n} pages.', { n: pages.length }) })
            }}
          />
        )
      case 'copy':
        return (
          <StampPagesDialog
            ctx={deps.ctx}
            heading={t('Copy stamp to pages')}
            onCancel={close}
            onSubmit={(pages) => {
              close()
              const src = dialog.annot
              const targets = pages.filter((p) => p !== src.page)
              if (!targets.length) return
              deps.commit((list) => [
                ...list,
                ...targets.map((p) => {
                  const size = deps.pages[p]
                  const copy = deps.newAnnot('stamp', p, src.rects.map((r) => ({ ...r, x: size ? Math.max(0, Math.min(size.width - r.w, r.x)) : r.x, y: size ? Math.max(0, Math.min(size.height - r.h, r.y)) : r.y })), src.text)
                  return { ...copy, color: src.color, lineWidth: src.lineWidth, stampInfo: src.stampInfo, image: src.image, signature: src.signature, angle: src.angle, opacity: src.opacity }
                })
              ])
              deps.notify({ kind: 'info', text: t('Stamp copied to {n} pages.', { n: targets.length }) })
            }}
          />
        )
    }
  })()

  return {
    choice,
    dated,
    setDated,
    opts,
    setOpts,
    open,
    setOpen,
    stamps,
    meta,
    pick,
    place,
    newStamp,
    edit,
    remove,
    exportCollection,
    importCollection,
    arm: (def: StampDef) => {
      setOpen(false)
      setDialog({ kind: 'arm', def })
    },
    copySelected,
    refresh: refreshImages,
    captureSnapshot,
    cancelCapture,
    dialogs
  }
}
