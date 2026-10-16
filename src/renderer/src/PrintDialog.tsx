import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Modal } from './AppDialogs'
import { PdfClient, type PageSize } from './pdfClient'
import { parsePageRanges } from './pageOps'
import { stripComments } from './stripComments'
import { plural, t } from './i18n'
import { sheetGrid, sheetSlots, type PrintLayout } from '../../shared/printLayout'
import {
  PAPER_SIZES,
  clampPercent,
  effectiveDuplex,
  effectiveScaling,
  faceCount,
  isPaperId,
  paperCount,
  paperLabel,
  paperPoints,
  placePage,
  resolveLandscape,
  selectPages,
  type Duplex,
  type Orientation,
  type PageRangeKind,
  type PaperId,
  type Scaling,
  type Subset
} from '../../shared/printPlan'
import type { PrintOptions } from './print'

/** Everything DocView needs to run a print job. */
export interface PrintJob {
  bytes: Uint8Array
  options: PrintOptions
}

interface Props {
  pageCount: number
  sizes: PageSize[]
  /** 0-based. */
  currentPage: number
  /** First and last 0-based pages showing in the view, or null when unknown. */
  viewRange: [number, number] | null
  /** The thumbnail selection (0-based). */
  selected: number[]
  /** The document as it should print: edits written in, hidden layers applied. */
  prepare: () => Promise<Uint8Array>
  onPrint: (job: PrintJob) => void
  onClose: () => void
}

type PerSheet = '1' | '2' | '4' | '6' | '9' | '16' | 'booklet'
type PrinterChoice = string // an installed printer's system name, FILE, or '' (the system's own dialog)
const FILE = '\u0000file'

/** The longest side of the preview sheet in CSS pixels. */
const PREVIEW_BOX = { w: 330, h: 400 }

export function PrintDialog({ pageCount, sizes, currentPage, viewRange, selected, prepare, onPrint, onClose }: Props) {
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[] | null>(null)
  const [printer, setPrinter] = useState<PrinterChoice>('')
  const [copies, setCopies] = useState(1)
  const [collate, setCollate] = useState(true)
  const [colour, setColour] = useState(true)
  const [duplex, setDuplex] = useState<Duplex>('off')
  const [paper, setPaper] = useState<PaperId>('A4')
  const [orientation, setOrientation] = useState<Orientation>('auto')

  const [range, setRange] = useState<PageRangeKind>('all')
  const [customText, setCustomText] = useState(pageCount > 1 ? `1-${pageCount}` : '1')
  const [subset, setSubset] = useState<Subset>('all')
  const [reverse, setReverse] = useState(false)

  const [scalingKind, setScalingKind] = useState<Scaling['kind']>('fit')
  const [percent, setPercent] = useState(100)
  const [autoRotate, setAutoRotate] = useState(true)
  const [centre, setCentre] = useState(true)
  const [perSheet, setPerSheet] = useState<PerSheet>('1')
  const [order, setOrder] = useState<'across' | 'down'>('across')
  const [border, setBorder] = useState(false)
  const [binding, setBinding] = useState<'left' | 'right'>('left')
  const [sides, setSides] = useState<'both' | 'front' | 'back'>('both')
  const [what, setWhat] = useState<'comments' | 'document'>('comments')

  const [face, setFace] = useState(0)
  const printerSelect = useRef<HTMLSelectElement>(null)

  // Installed printers and what was used last time.
  useEffect(() => {
    let live = true
    void (async () => {
      const [list, settings] = await Promise.all([window.openpdf.printPrinters().catch(() => []), window.openpdf.getSettings().catch(() => null)])
      if (!live) return
      setPrinters(list)
      const remembered = settings?.printer && list.some((p) => p.name === settings.printer) ? settings.printer : null
      setPrinter(remembered ?? list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? '')
      if (isPaperId(settings?.printPaper)) setPaper(settings.printPaper)
    })()
    return () => {
      live = false
    }
  }, [])
  // The modal focuses its first control (the close button) after this runs, so focus is taken back a moment later.
  useEffect(() => {
    const id = window.setTimeout(() => printerSelect.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [])

  // ---- What will print ----
  const custom = useMemo(() => {
    if (range !== 'custom') return { list: [] as number[], error: '' }
    try {
      return { list: parsePageRanges(customText, pageCount), error: '' }
    } catch (e) {
      return { list: [] as number[], error: e instanceof Error ? e.message : String(e) }
    }
  }, [range, customText, pageCount])
  const list = useMemo(
    () => selectPages({ count: pageCount, range, current: currentPage, view: viewRange, selected, custom: custom.list, subset, reverse }),
    [pageCount, range, currentPage, viewRange, selected, custom.list, subset, reverse]
  )
  const layout: PrintLayout = useMemo(
    () =>
      perSheet === 'booklet'
        ? { kind: 'booklet', binding, sides }
        : perSheet === '1'
          ? { kind: 'single' }
          : { kind: 'nup', perSheet: Number(perSheet) as 2 | 4 | 6 | 9 | 16, order, border },
    [perSheet, binding, sides, order, border]
  )
  const scaling: Scaling = scalingKind === 'custom' ? { kind: 'custom', percent: clampPercent(percent) } : { kind: scalingKind }
  const first = list.length ? sizes[list[0]] : undefined
  const landscape = resolveLandscape(orientation, layout, !!first && first.width > first.height, autoRotate)
  const rotate = autoRotate && layout.kind === 'single' && !landscape
  const toFile = printer === FILE
  const duplexUsed = toFile ? 'off' : effectiveDuplex(duplex, layout)
  const slots = useMemo(() => sheetSlots(list.length, layout), [list.length, layout])
  const faces = faceCount(list.length, layout)
  const paperSheets = paperCount(faces, duplexUsed)
  const shownFace = Math.min(face, Math.max(0, faces - 1))

  // ---- The document the preview and the job use ----
  // Edits and layers are written in once; "Document" (without comments) is a copy with the markup taken out.
  const [full, setFull] = useState<Uint8Array | null>(null)
  const [loaded, setLoaded] = useState<{ client: PdfClient; bytes: Uint8Array; what: typeof what } | null>(null)
  const [problem, setProblem] = useState('')
  const plain = useRef<Uint8Array | null>(null)
  useEffect(() => {
    let live = true
    prepare().then(
      (b) => live && setFull(b),
      (e) => live && setProblem(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!full) return
    let live = true
    let made: PdfClient | null = null
    void (async () => {
      try {
        let bytes = full
        if (what === 'document') bytes = plain.current ??= await stripComments(full)
        made = new PdfClient()
        await made.load(bytes)
        if (!live) return made.dispose()
        setProblem('')
        setLoaded({ client: made, bytes, what })
      } catch (e) {
        made?.dispose()
        if (live) setProblem(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      live = false
      made?.dispose()
    }
  }, [full, what])
  const ready = loaded !== null && loaded.what === what

  // ---- Can it print? ----
  let blocked = ''
  if (custom.error) blocked = custom.error
  else if (list.length === 0) blocked = range === 'selected' ? t('No pages are selected in the thumbnails') : t('There are no pages to print')
  else if (problem) blocked = problem
  else if (!ready) blocked = t('Preparing the document…')

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (blocked || !loaded) return
    if (!toFile) void window.openpdf.setSettings({ printer, printPaper: paper }).catch(() => undefined)
    else void window.openpdf.setSettings({ printPaper: paper }).catch(() => undefined)
    onPrint({
      bytes: loaded.bytes,
      options: {
        pages: list,
        copies: toFile ? 1 : copies,
        layout,
        scaling,
        centre,
        landscape,
        paper,
        colour,
        duplex: duplexUsed,
        collate,
        autoRotate,
        deviceName: toFile ? undefined : printer || undefined,
        toFile
      }
    })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    // Enter prints from anywhere but a button (where it presses that button).
    const tag = (e.target as HTMLElement).tagName
    if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') submit(e as unknown as FormEvent)
  }

  const noPrinters = printers !== null && printers.length === 0
  return (
    <Modal title={t('Print')} onClose={onClose} wide>
      <form className="print-modal" onSubmit={submit} onKeyDown={onKeyDown}>
        <div className="print-options">
          <fieldset>
            <legend>{t('Printer')}</legend>
            <Row label={t('Name')}>
              <select ref={printerSelect} aria-label={t('Printer')} value={printer} onChange={(e) => setPrinter(e.target.value)} disabled={printers === null}>
                {noPrinters && <option value="">{t('System print dialog')}</option>}
                {(printers ?? []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                    {p.isDefault ? ` (${t('default')})` : ''}
                  </option>
                ))}
                <option value={FILE}>{t('Print to PDF file')}</option>
              </select>
            </Row>
            <Row label={t('Copies')}>
              <span className="print-inline">
                <input
                  type="number"
                  min={1}
                  max={999}
                  aria-label={t('Copies')}
                  value={copies}
                  disabled={toFile}
                  onChange={(e) => setCopies(Math.max(1, Math.min(999, Math.round(Number(e.target.value)) || 1)))}
                />
                <label>
                  <input type="checkbox" checked={collate} disabled={toFile || copies < 2} onChange={(e) => setCollate(e.target.checked)} />
                  {t('Collate')}
                </label>
              </span>
            </Row>
            <Row label={t('Colour')}>
              <select aria-label={t('Colour')} value={colour ? 'colour' : 'grey'} disabled={toFile} onChange={(e) => setColour(e.target.value === 'colour')}>
                <option value="colour">{t('Colour')}</option>
                <option value="grey">{t('Greyscale')}</option>
              </select>
            </Row>
            <Row label={t('Two-sided')}>
              <select
                aria-label={t('Two-sided')}
                value={duplexUsed}
                disabled={toFile || layout.kind === 'booklet'}
                onChange={(e) => setDuplex(e.target.value as Duplex)}
                title={layout.kind === 'booklet' ? t('Booklets are set by the booklet options') : undefined}
              >
                <option value="off">{t('Off')}</option>
                <option value="long">{t('Long edge')}</option>
                <option value="short">{t('Short edge')}</option>
              </select>
            </Row>
            <Row label={t('Paper size')}>
              <select aria-label={t('Paper size')} value={paper} onChange={(e) => setPaper(e.target.value as PaperId)}>
                {(Object.keys(PAPER_SIZES) as PaperId[]).map((id) => (
                  <option key={id} value={id}>
                    {PAPER_SIZES[id].label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('Orientation')}>
              <select aria-label={t('Orientation')} value={orientation} disabled={layout.kind === 'booklet'} onChange={(e) => setOrientation(e.target.value as Orientation)}>
                <option value="auto">{t('Auto')}</option>
                <option value="portrait">{t('Portrait')}</option>
                <option value="landscape">{t('Landscape')}</option>
              </select>
            </Row>
          </fieldset>

          <fieldset>
            <legend>{t('Pages to print')}</legend>
            <Row label={t('Range')}>
              <select aria-label={t('Page range')} value={range} onChange={(e) => setRange(e.target.value as PageRangeKind)}>
                <option value="all">{t('All pages')}</option>
                <option value="current">{t('Current page ({n})', { n: currentPage + 1 })}</option>
                <option value="view" disabled={!viewRange}>
                  {viewRange ? t('Current view (pages {a} to {b})', { a: viewRange[0] + 1, b: viewRange[1] + 1 }) : t('Current view')}
                </option>
                <option value="selected" disabled={selected.length === 0}>
                  {t('Selected pages ({n})', { n: selected.length })}
                </option>
                <option value="custom">{t('Pages')}</option>
              </select>
            </Row>
            {range === 'custom' && (
              <Row label="">
                <input
                  aria-label={t('Page range, for example 1-3, 5')}
                  aria-invalid={custom.error ? true : undefined}
                  placeholder="1-3, 5"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                />
              </Row>
            )}
            <Row label={t('Subset')}>
              <select aria-label={t('Subset')} value={subset} onChange={(e) => setSubset(e.target.value as Subset)}>
                <option value="all">{t('All pages in range')}</option>
                <option value="odd">{t('Odd pages only')}</option>
                <option value="even">{t('Even pages only')}</option>
              </select>
            </Row>
            <Row label="">
              <label>
                <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
                {t('Reverse order')}
              </label>
            </Row>
          </fieldset>

          <fieldset>
            <legend>{t('Page handling')}</legend>
            <Row label={t('Scaling')}>
              <span className="print-inline">
                <select aria-label={t('Page scaling')} value={scalingKind} disabled={perSheet !== '1'} onChange={(e) => setScalingKind(e.target.value as Scaling['kind'])}>
                  <option value="fit">{t('Fit to printable area')}</option>
                  <option value="shrink">{t('Shrink oversized pages only')}</option>
                  <option value="actual">{t('None (actual size)')}</option>
                  <option value="custom">{t('Custom scale')}</option>
                </select>
                {scalingKind === 'custom' && perSheet === '1' && (
                  <>
                    <input type="number" min={10} max={400} aria-label={t('Custom scale (percent)')} value={percent} onChange={(e) => setPercent(Number(e.target.value) || 100)} onBlur={() => setPercent(clampPercent(percent))} />
                    <span>%</span>
                  </>
                )}
              </span>
            </Row>
            <Row label="">
              <span className="print-inline">
                <label title={t('Turn landscape pages so they fill portrait paper')}>
                  <input type="checkbox" checked={autoRotate} disabled={perSheet !== '1'} onChange={(e) => setAutoRotate(e.target.checked)} />
                  {t('Auto-rotate')}
                </label>
                <label>
                  <input type="checkbox" checked={centre} disabled={perSheet !== '1' || scalingKind === 'fit'} onChange={(e) => setCentre(e.target.checked)} />
                  {t('Auto-centre')}
                </label>
              </span>
            </Row>
            <Row label={t('Pages per sheet')}>
              <select aria-label={t('Pages per sheet')} value={perSheet} onChange={(e) => setPerSheet(e.target.value as PerSheet)}>
                <option value="1">{t('1 page per sheet')}</option>
                {[2, 4, 6, 9, 16].map((n) => (
                  <option key={n} value={String(n)}>
                    {t('{n} pages per sheet', { n })}
                  </option>
                ))}
                <option value="booklet">{t('Booklet (fold in the middle)')}</option>
              </select>
            </Row>
            {perSheet !== '1' && perSheet !== 'booklet' && (
              <>
                <Row label={t('Page order')}>
                  <select aria-label={t('Page order')} value={order} onChange={(e) => setOrder(e.target.value as 'across' | 'down')}>
                    <option value="across">{t('Across, then down')}</option>
                    <option value="down">{t('Down, then across')}</option>
                  </select>
                </Row>
                <Row label="">
                  <label>
                    <input type="checkbox" checked={border} onChange={(e) => setBorder(e.target.checked)} />
                    {t('Border around each page')}
                  </label>
                </Row>
              </>
            )}
            {perSheet === 'booklet' && (
              <>
                <Row label={t('Binding')}>
                  <select aria-label={t('Binding')} value={binding} onChange={(e) => setBinding(e.target.value as 'left' | 'right')}>
                    <option value="left">{t('Left')}</option>
                    <option value="right">{t('Right')}</option>
                  </select>
                </Row>
                <Row label={t('Sides')}>
                  <select aria-label={t('Booklet sides')} value={sides} onChange={(e) => setSides(e.target.value as 'both' | 'front' | 'back')}>
                    <option value="both">{t('Both sides')}</option>
                    <option value="front">{t('Front side only')}</option>
                    <option value="back">{t('Back side only')}</option>
                  </select>
                </Row>
              </>
            )}
          </fieldset>

          <fieldset>
            <legend>{t('Print what')}</legend>
            <Row label="">
              <select aria-label={t('Print what')} value={what} onChange={(e) => setWhat(e.target.value as 'comments' | 'document')}>
                <option value="comments">{t('Document and comments')}</option>
                <option value="document">{t('Document')}</option>
              </select>
            </Row>
          </fieldset>
        </div>

        <div className="print-side">
          <div className="print-preview" aria-label={t('Preview')}>
            {loaded && ready && faces > 0 ? (
              <SheetPreview
                client={loaded.client}
                sizes={sizes}
                list={list}
                slots={slots[shownFace] ?? []}
                layout={layout}
                scaling={scaling}
                centre={centre}
                landscape={landscape}
                rotate={rotate}
                paper={paper}
                grey={!colour && !toFile}
              />
            ) : (
              <p className="muted">{problem ? problem : faces === 0 ? t('Nothing to preview') : t('Preparing the preview…')}</p>
            )}
          </div>
          <div className="print-pager">
            <button type="button" aria-label={t('Previous sheet')} title={t('Previous sheet')} disabled={shownFace <= 0} onClick={() => setFace(shownFace - 1)}>
              ◀
            </button>
            <span role="status" className="print-sheet-label">
              {faces > 0 ? `${t('Sheet {n} of {total}', { n: shownFace + 1, total: faces })} · ${paperLabel(paper, landscape)}` : t('No pages selected')}
            </span>
            <button type="button" aria-label={t('Next sheet')} title={t('Next sheet')} disabled={shownFace >= faces - 1} onClick={() => setFace(shownFace + 1)}>
              ▶
            </button>
          </div>
          <p className="print-summary muted" role="status">
            {plural(list.length, { one: '{n} page', other: '{n} pages' })}
            {' · '}
            {plural(paperSheets, { one: '{n} sheet of paper', other: '{n} sheets of paper' })}
            {copies > 1 && !toFile ? ` × ${plural(copies, { one: '{n} copy', other: '{n} copies' })}` : ''}
          </p>
        </div>

        <div className="print-buttons">
          {blocked && (
            <span className="print-reason" role="alert">
              {blocked}
            </span>
          )}
          <button className="primary" type="submit" disabled={!!blocked} title={blocked || undefined}>
            {toFile ? t('Save as PDF…') : t('Print')}
          </button>
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="print-row">
      <span className="print-label">{label}</span>
      <div>{children}</div>
    </div>
  )
}

interface PlacedCell {
  page: number
  /** CSS pixels, relative to the sheet. */
  left: number
  top: number
  w: number
  h: number
  /** The page inside the cell. */
  px: number
  py: number
  pw: number
  ph: number
}

/** One printed face drawn to scale on a sheet of the chosen paper, using the same placement rules as the print job. */
function SheetPreview(props: {
  client: PdfClient
  sizes: PageSize[]
  list: number[]
  slots: (number | null)[]
  layout: PrintLayout
  scaling: Scaling
  centre: boolean
  landscape: boolean
  rotate: boolean
  paper: PaperId
  grey: boolean
}) {
  const { client, sizes, list, slots, layout, scaling, centre, landscape, rotate, paper, grey } = props
  const sheetPt = paperPoints(paper, landscape)
  const k = Math.min(PREVIEW_BOX.w / sheetPt.w, PREVIEW_BOX.h / sheetPt.h) // CSS pixels per point
  const sc = effectiveScaling(layout, scaling)
  const inset = sc.kind === 'fit' ? 18 : 0 // a printer's unprintable edge, as in the print job
  const { cols, rows } = sheetGrid(layout)
  const areaW = sheetPt.w - 2 * inset
  const areaH = sheetPt.h - 2 * inset
  const gap = cols > 1 ? 0.02 * areaW : 0
  const cw = (areaW - gap * (cols - 1)) / cols
  const ch = (areaH - gap * (rows - 1)) / rows
  const border = layout.kind === 'nup' && layout.border === true

  const cells = useMemo(() => {
    const out: PlacedCell[] = []
    slots.forEach((slot, i) => {
      if (slot === null) return
      const page = list[slot]
      const size = sizes[page]
      if (!size) return
      const w = rotate && size.width > size.height ? size.height : size.width
      const h = rotate && size.width > size.height ? size.width : size.height
      const p = placePage({ w: cw, h: ch }, { w, h }, sc, centre)
      out.push({
        page,
        left: (inset + (i % cols) * (cw + gap)) * k,
        top: (inset + Math.floor(i / cols) * (ch + gap)) * k,
        w: cw * k,
        h: ch * k,
        px: p.x * k,
        py: p.y * k,
        pw: p.w * k,
        ph: p.h * k
      })
    })
    return out
  }, [slots, list, sizes, rotate, cw, ch, sc, centre, inset, cols, gap, k])

  const canvases = useRef(new Map<number, HTMLCanvasElement>())
  useEffect(() => {
    const ctrl = new AbortController()
    const dpr = window.devicePixelRatio || 1
    // A short wait so dragging through settings does not queue a render for each step.
    const timer = window.setTimeout(() => {
      for (const c of cells) {
        const size = sizes[c.page]
        const turn = rotate && size.width > size.height
        const scale = Math.min((c.pw * dpr) / (turn ? size.height : size.width), 2000 / Math.max(size.width, size.height))
        client.render(c.page, scale, { priority: 2, signal: ctrl.signal }).then(
          (out) => {
            const canvas = canvases.current.get(c.page)
            if (!canvas || ctrl.signal.aborted) return
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            const img = new ImageData(new Uint8ClampedArray(out.data.buffer as ArrayBuffer, out.data.byteOffset, out.data.byteLength), out.width, out.height)
            if (!turn) {
              canvas.width = out.width
              canvas.height = out.height
              ctx.putImageData(img, 0, 0)
              return
            }
            const tmp = document.createElement('canvas')
            tmp.width = out.width
            tmp.height = out.height
            tmp.getContext('2d')?.putImageData(img, 0, 0)
            canvas.width = out.height
            canvas.height = out.width
            ctx.translate(out.height, 0)
            ctx.rotate(Math.PI / 2)
            ctx.drawImage(tmp, 0, 0)
            ctx.setTransform(1, 0, 0, 1, 0, 0)
          },
          () => undefined // aborted or the document went away
        )
      }
    }, 120)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [client, cells, sizes, rotate])

  return (
    <div className="print-sheet" style={{ width: sheetPt.w * k, height: sheetPt.h * k, filter: grey ? 'grayscale(1)' : undefined }} data-testid="print-sheet">
      {cells.map((c) => (
        <div key={c.page} className="print-cell" style={{ left: c.left, top: c.top, width: c.w, height: c.h }}>
          <canvas
            ref={(el) => {
              if (el) canvases.current.set(c.page, el)
              else canvases.current.delete(c.page)
            }}
            className={border ? 'print-page bordered' : 'print-page'}
            style={{ left: c.px, top: c.py, width: c.pw, height: c.ph }}
          />
        </div>
      ))}
    </div>
  )
}
