import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Modal } from './AppDialogs'
import { PdfClient, type PageSize } from './pdfClient'
import { parsePageRanges } from './pageOps'
import { printCopy, type PrintWhat } from './printCopy'
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
import { tileArea, type PrintOptions } from './print'
import type { PrintDefaults } from './viewPrefs'
import type { PrintLayers } from './layers'
import { bestPrintLandscape, clampTileScale, mmToPt, tileLabel, tileSheets, type TileOptions } from '../../shared/tiling'

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
  prepare: (layers: PrintLayers) => Promise<Uint8Array>
  /** Layers (optional content groups) the document has; the choice of layers is offered only when there are some. */
  layerCount?: number
  onPrint: (job: PrintJob) => void
  onClose: () => void
  /** What the document's own print presets ask the dialog to start with. */
  defaults?: PrintDefaults | null
}

type PerSheet = '1' | '2' | '4' | '6' | '9' | '16' | 'booklet'
type PrinterChoice = string // an installed printer's system name, FILE, or '' (the system's own dialog)
const FILE = '\u0000file'

/** The longest side of the preview sheet in CSS pixels. */
const PREVIEW_BOX = { w: 330, h: 400 }

export function PrintDialog({ pageCount, sizes, currentPage, viewRange, selected, prepare, layerCount = 0, onPrint, onClose, defaults }: Props) {
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[] | null>(null)
  const [printer, setPrinter] = useState<PrinterChoice>('')
  const [copies, setCopies] = useState(defaults?.copies ?? 1)
  const [collate, setCollate] = useState(true)
  const [colour, setColour] = useState(true)
  const [duplex, setDuplex] = useState<Duplex>(defaults?.duplex ?? 'off')
  const [paper, setPaper] = useState<PaperId>('A4')
  const [orientation, setOrientation] = useState<Orientation>('auto')

  const [range, setRange] = useState<PageRangeKind>(defaults?.rangeText ? 'custom' : 'all')
  const [customText, setCustomText] = useState(defaults?.rangeText || (pageCount > 1 ? `1-${pageCount}` : '1'))
  const [subset, setSubset] = useState<Subset>('all')
  const [reverse, setReverse] = useState(false)

  const [scalingKind, setScalingKind] = useState<Scaling['kind']>(defaults?.scaling ?? 'fit')
  const [percent, setPercent] = useState(100)
  const [autoRotate, setAutoRotate] = useState(true)
  const [centre, setCentre] = useState(true)
  const [perSheet, setPerSheet] = useState<PerSheet>('1')
  const [order, setOrder] = useState<'across' | 'down'>('across')
  const [border, setBorder] = useState(false)
  const [binding, setBinding] = useState<'left' | 'right'>('left')
  const [sides, setSides] = useState<'both' | 'front' | 'back'>('both')
  const [what, setWhat] = useState<PrintWhat>('comments')
  const [layerMode, setLayerMode] = useState<PrintLayers>('visible')
  // Save as PDF keeps the text (vector) unless this is turned off.
  const [keepText, setKeepText] = useState(true)
  // Tiling a large page over several sheets (replaces the scaling choice and pages per sheet while on).
  const [tileOn, setTileOn] = useState(false)
  const [tileScale, setTileScale] = useState(100)
  const [tileOverlap, setTileOverlap] = useState(10)
  const [tileMarks, setTileMarks] = useState(true)
  const [tileLabels, setTileLabels] = useState(true)

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
      // The document's own wish (choose the paper by page size) beats the paper used last time.
      if (defaults?.paper) setPaper(defaults.paper)
      else if (isPaperId(settings?.printPaper)) setPaper(settings.printPaper)
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
  const tileOpts: TileOptions | undefined = tileOn ? { scalePct: clampTileScale(tileScale), overlapMm: Math.max(0, tileOverlap), marks: tileMarks, labels: tileLabels } : undefined
  const landscape = tileOpts
    ? orientation === 'auto'
      ? !!first && bestPrintLandscape(first.width, first.height, tileArea(paper, false), tileOpts.scalePct / 100, mmToPt(tileOpts.overlapMm))
      : orientation === 'landscape'
    : resolveLandscape(orientation, layout, !!first && first.width > first.height, autoRotate)
  const rotate = !tileOn && autoRotate && layout.kind === 'single' && !landscape
  const toFile = printer === FILE
  const duplexUsed = toFile ? 'off' : effectiveDuplex(duplex, layout)
  const slots = useMemo(() => sheetSlots(list.length, layout), [list.length, layout])
  const tileList = useMemo(
    () => (tileOpts ? tileSheets(list.map((p) => ({ w: sizes[p]?.width ?? 0, h: sizes[p]?.height ?? 0 })), tileArea(paper, landscape), tileOpts) : []),
    [list, sizes, paper, landscape, tileOpts?.scalePct, tileOpts?.overlapMm] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const faces = tileOn ? tileList.length : faceCount(list.length, layout)
  const paperSheets = paperCount(faces, duplexUsed)
  const shownFace = Math.min(face, Math.max(0, faces - 1))

  // ---- The document the preview and the job use ----
  // Edits and layers are written in once; each choice of what to print is a copy of that: comments that are not
  // printable are left out of all of them, "Document" has the markup taken out, "Comments only" the page taken out.
  const [full, setFull] = useState<Uint8Array | null>(null)
  const [loaded, setLoaded] = useState<{ client: PdfClient; bytes: Uint8Array; what: typeof what } | null>(null)
  const [problem, setProblem] = useState('')
  const printCopies = useRef(new Map<PrintWhat, Uint8Array>())
  useEffect(() => {
    let live = true
    setLoaded(null)
    prepare(layerMode).then(
      (b) => {
        if (!live) return
        printCopies.current.clear()
        setFull(b)
      },
      (e) => live && setProblem(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
  }, [layerMode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!full) return
    let live = true
    let made: PdfClient | null = null
    void (async () => {
      try {
        let bytes = printCopies.current.get(what)
        if (!bytes) {
          try {
            bytes = await printCopy(full, what)
          } catch (e) {
            // The default printout must not fail because the copy could not be made: print the file as it is.
            if (what !== 'comments') throw e
            bytes = full
          }
          printCopies.current.set(what, bytes)
        }
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
        autoRotate: autoRotate && !tileOn,
        tile: tileOpts,
        vector: toFile && keepText && !tileOn,
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
          {defaults?.any && (
            <p className="muted small" role="status">
              {t('Started with the print settings saved in this document.')}
            </p>
          )}
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
                <select
                  aria-label={t('Page scaling')}
                  value={tileOn ? 'tile' : scalingKind}
                  disabled={perSheet !== '1' && !tileOn}
                  onChange={(e) => {
                    const v = e.target.value
                    setTileOn(v === 'tile')
                    if (v === 'tile') setPerSheet('1')
                    else setScalingKind(v as Scaling['kind'])
                    setFace(0)
                  }}
                >
                  <option value="fit">{t('Fit to printable area')}</option>
                  <option value="shrink">{t('Shrink oversized pages only')}</option>
                  <option value="actual">{t('None (actual size)')}</option>
                  <option value="custom">{t('Custom scale')}</option>
                  <option value="tile">{t('Tile large pages')}</option>
                </select>
                {scalingKind === 'custom' && perSheet === '1' && !tileOn && (
                  <>
                    <input type="number" min={10} max={400} aria-label={t('Custom scale (percent)')} value={percent} onChange={(e) => setPercent(Number(e.target.value) || 100)} onBlur={() => setPercent(clampPercent(percent))} />
                    <span>%</span>
                  </>
                )}
              </span>
            </Row>
            {tileOn && (
              <>
                <Row label={t('Tile scale')}>
                  <span className="print-inline">
                    <input type="number" min={10} max={400} aria-label={t('Tile scale (percent)')} value={tileScale} onChange={(e) => setTileScale(Number(e.target.value) || 100)} onBlur={() => setTileScale(clampTileScale(tileScale))} />
                    <span>%</span>
                  </span>
                </Row>
                <Row label={t('Overlap')}>
                  <span className="print-inline">
                    <input type="number" min={0} max={50} aria-label={t('Tile overlap (mm)')} value={tileOverlap} onChange={(e) => setTileOverlap(Math.max(0, Number(e.target.value) || 0))} />
                    <span>mm</span>
                  </span>
                </Row>
                <Row label="">
                  <span className="print-inline">
                    <label>
                      <input type="checkbox" checked={tileMarks} onChange={(e) => setTileMarks(e.target.checked)} />
                      {t('Cut marks')}
                    </label>
                    <label>
                      <input type="checkbox" checked={tileLabels} onChange={(e) => setTileLabels(e.target.checked)} />
                      {t('Labels')}
                    </label>
                  </span>
                </Row>
              </>
            )}
            <Row label="">
              <span className="print-inline">
                <label title={t('Turn landscape pages so they fill portrait paper')}>
                  <input type="checkbox" checked={autoRotate} disabled={perSheet !== '1' || tileOn} onChange={(e) => setAutoRotate(e.target.checked)} />
                  {t('Auto-rotate')}
                </label>
                <label>
                  <input type="checkbox" checked={centre} disabled={perSheet !== '1' || scalingKind === 'fit' || tileOn} onChange={(e) => setCentre(e.target.checked)} />
                  {t('Auto-centre')}
                </label>
              </span>
            </Row>
            <Row label={t('Pages per sheet')}>
              <select aria-label={t('Pages per sheet')} value={perSheet} disabled={tileOn} onChange={(e) => setPerSheet(e.target.value as PerSheet)}>
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
              <select aria-label={t('Print what')} value={what} onChange={(e) => setWhat(e.target.value as PrintWhat)}>
                <option value="comments">{t('Document and comments')}</option>
                <option value="document">{t('Document')}</option>
                <option value="markup">{t('Comments only')}</option>
              </select>
            </Row>
            <Row label="">
              <span className="muted small">{t('Comments marked as not printable (Properties panel) are left out.')}</span>
            </Row>
            {layerCount > 0 && (
              <Row label={t('Layers')}>
                <select aria-label={t('Layers to print')} value={layerMode} onChange={(e) => setLayerMode(e.target.value as PrintLayers)}>
                  <option value="visible">{t('Visible layers (as shown now)')}</option>
                  <option value="all">{t('All layers')}</option>
                  <option value="file">{t('Layers as set in the file')}</option>
                </select>
              </Row>
            )}
            {toFile && (
              <Row label="">
                <label title={t('Write the pages as vector content so the text stays text. Turn off to print the pages as pictures.')}>
                  <input type="checkbox" checked={keepText && !tileOn} disabled={tileOn} onChange={(e) => setKeepText(e.target.checked)} />
                  {t('Keep text searchable (vector)')}
                </label>
              </Row>
            )}
          </fieldset>
        </div>

        <div className="print-side">
          <div className="print-preview" aria-label={t('Preview')}>
            {loaded && ready && faces > 0 && tileOpts ? (
              <TilePreview client={loaded.client} sizes={sizes} sheet={tileList[Math.min(shownFace, tileList.length - 1)]} area={tileArea(paper, landscape)} paper={paper} landscape={landscape} opts={tileOpts} grey={!colour && !toFile} />
            ) : loaded && ready && faces > 0 ? (
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
              {faces > 0 ? `${t('Sheet {n} of {total}', { n: shownFace + 1, total: faces })} · ${paperLabel(paper, landscape)}${tileOn && tileList[shownFace] ? ` · ${tileLabel(tileList[shownFace].page, tileList[shownFace].tile, tileList[shownFace].grid)}` : ''}` : t('No pages selected')}
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

/** One sheet of a tiled printout drawn to scale: the part of the page its tile covers, with the marks and label. */
function TilePreview(props: {
  client: PdfClient
  sizes: PageSize[]
  sheet: { page: number; tile: { x: number; y: number; w: number; h: number; row: number; col: number }; grid: { rows: number; cols: number } } | undefined
  area: { w: number; h: number }
  paper: PaperId
  landscape: boolean
  opts: TileOptions
  grey: boolean
}) {
  const { client, sizes, sheet, area, paper, landscape, opts, grey } = props
  const sheetPt = paperPoints(paper, landscape)
  const k = Math.min(PREVIEW_BOX.w / sheetPt.w, PREVIEW_BOX.h / sheetPt.h)
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = sheet ? sizes[sheet.page] : undefined
  const inset = 18
  const s = opts.scalePct / 100
  // The part of the page on this sheet, in preview pixels (the printable area starts `inset` points in).
  const visW = size && sheet ? Math.max(0, Math.min(area.w, (size.width - sheet.tile.x) * s)) * k : 0
  const visH = size && sheet ? Math.max(0, Math.min(area.h, (size.height - sheet.tile.y) * s)) * k : 0
  useEffect(() => {
    if (!sheet || !size) return
    const ctrl = new AbortController()
    const dpr = window.devicePixelRatio || 1
    // A short wait so changing a setting does not queue a render for each step.
    const timer = window.setTimeout(() => {
      const scale = k * s * dpr
      const cw = Math.max(1, Math.round(area.w * k * dpr))
      const ch = Math.max(1, Math.round(area.h * k * dpr))
      client.render(sheet.page, scale, { priority: 2, signal: ctrl.signal, region: { x: Math.round(sheet.tile.x * scale), y: Math.round(sheet.tile.y * scale), w: cw, h: ch } }).then(
        (out) => {
          const el = canvas.current
          const ctx = el?.getContext('2d')
          if (!el || !ctx || ctrl.signal.aborted) return
          el.width = out.width
          el.height = out.height
          ctx.putImageData(new ImageData(new Uint8ClampedArray(out.data.buffer as ArrayBuffer, out.data.byteOffset, out.data.byteLength), out.width, out.height), 0, 0)
        },
        () => undefined // aborted or the document went away
      )
    }, 120)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [client, sheet, size, k, s, area.w, area.h])
  const mark = 5 * (72 / 25.4) * k
  return (
    <div
      className="print-sheet"
      style={{ width: sheetPt.w * k, height: sheetPt.h * k, filter: grey ? 'grayscale(1)' : undefined, position: 'relative' }}
      data-testid="print-sheet"
      data-tile-sheet={sheet ? `${sheet.page + 1}:${sheet.tile.row + 1}:${sheet.tile.col + 1}` : ''}
    >
      <canvas ref={canvas} data-testid="tile-canvas" style={{ position: 'absolute', left: inset * k, top: inset * k, width: area.w * k, height: area.h * k }} />
      {opts.marks &&
        visW > 0 &&
        (
          [
            [0, 0, 1, 1],
            [visW, 0, -1, 1],
            [0, visH, 1, -1],
            [visW, visH, -1, -1]
          ] as const
        ).map(([x, y, sx, sy], i) => (
          <span
            key={i}
            aria-hidden
            data-testid="tile-mark"
            style={{
              position: 'absolute',
              left: inset * k + x + (sx < 0 ? -mark : 0),
              top: inset * k + y + (sy < 0 ? -mark : 0),
              width: mark,
              height: mark,
              borderTop: sy > 0 ? '1px solid #000' : undefined,
              borderBottom: sy < 0 ? '1px solid #000' : undefined,
              borderLeft: sx > 0 ? '1px solid #000' : undefined,
              borderRight: sx < 0 ? '1px solid #000' : undefined
            }}
          />
        ))}
      {opts.labels && sheet && (
        <span data-testid="tile-label" style={{ position: 'absolute', left: inset * k + 6, bottom: inset * k + 6, fontSize: 8, background: 'rgba(255,255,255,0.9)', padding: '1px 3px' }}>
          {tileLabel(sheet.page, sheet.tile, sheet.grid)}
        </span>
      )}
    </div>
  )
}
