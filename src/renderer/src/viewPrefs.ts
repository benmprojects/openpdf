/**
 * Initial view and print presets: the catalogue's /PageLayout, /PageMode, /OpenAction and /ViewerPreferences
 * (ISO 32000-1 7.7.2 and 12.2). Reading and writing only touch the entries this module knows; any other
 * viewer preference, and an open action that is not a plain "go to a page" one, are left as they are.
 */
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib'
import { PAPER_SIZES, type PaperId } from '../../shared/printPlan'

export type PageLayoutName = 'Default' | 'SinglePage' | 'OneColumn' | 'TwoColumnLeft' | 'TwoColumnRight' | 'TwoPageLeft' | 'TwoPageRight'
export type PageModeName = 'Default' | 'UseNone' | 'UseOutlines' | 'UseThumbs' | 'UseOC' | 'UseAttachments' | 'FullScreen'
export type Magnification = { kind: 'default' } | { kind: 'fit-page' } | { kind: 'fit-width' } | { kind: 'fit-visible' } | { kind: 'zoom'; percent: number }
export type PrintScalingName = 'AppDefault' | 'None'
export type DuplexName = 'Default' | 'Simplex' | 'DuplexFlipShortEdge' | 'DuplexFlipLongEdge'

export interface ViewPrefs {
  layout: PageLayoutName
  pageMode: PageModeName
  magnification: Magnification
  /** The page the document opens on, from 1. */
  openPage: number
  /** The file has an open action of another kind (a script, a link): it is kept, and the magnification and page are not written. */
  foreignOpenAction: boolean
  fitWindow: boolean
  centreWindow: boolean
  displayTitle: boolean
  hideToolbar: boolean
  hideMenubar: boolean
  hideWindowUI: boolean
  printScaling: PrintScalingName
  duplex: DuplexName
  /** Number of copies the print dialog starts with: 1 (no entry) to 5, the most the file format allows. */
  numCopies: number
  pickTray: boolean
  /** Inclusive page ranges from 1; empty means all pages. */
  printRange: [number, number][]
  /** The catalogue's /URI /Base: the address that relative web links in the document are taken from ('' for none). */
  baseUrl: string
  /** The Info dictionary's /Trapped: whether the file has been prepared for printing with trapping. */
  trapped: 'Unknown' | 'True' | 'False'
}

export const DEFAULT_VIEW_PREFS: ViewPrefs = {
  layout: 'Default',
  pageMode: 'Default',
  magnification: { kind: 'default' },
  openPage: 1,
  foreignOpenAction: false,
  fitWindow: false,
  centreWindow: false,
  displayTitle: false,
  hideToolbar: false,
  hideMenubar: false,
  hideWindowUI: false,
  printScaling: 'AppDefault',
  duplex: 'Default',
  numCopies: 1,
  pickTray: false,
  printRange: [],
  baseUrl: '',
  trapped: 'Unknown'
}

const LAYOUTS: PageLayoutName[] = ['SinglePage', 'OneColumn', 'TwoColumnLeft', 'TwoColumnRight', 'TwoPageLeft', 'TwoPageRight']
const MODES: PageModeName[] = ['UseNone', 'UseOutlines', 'UseThumbs', 'UseOC', 'UseAttachments', 'FullScreen']
const DUPLEXES: DuplexName[] = ['Simplex', 'DuplexFlipShortEdge', 'DuplexFlipLongEdge']

const nameOf = (o: PDFObject | undefined): string | null => (o instanceof PDFName ? o.decodeText() : null)
const numOf = (o: PDFObject | undefined): number | null => (o instanceof PDFNumber ? o.asNumber() : null)
const flag = (d: PDFDict | undefined, key: string): boolean => d?.lookup(PDFName.of(key)) instanceof PDFBool && (d.lookup(PDFName.of(key)) as PDFBool).asBoolean()

/** The destination array of an open action: the array itself, or the /D of a GoTo action. Null for any other action. */
function openDestination(doc: PDFDocument): { array: PDFArray | null; foreign: boolean } {
  const oa = doc.catalog.lookup(PDFName.of('OpenAction'))
  if (!oa) return { array: null, foreign: false }
  if (oa instanceof PDFArray) return { array: oa, foreign: false }
  if (oa instanceof PDFDict && nameOf(oa.lookup(PDFName.of('S'))) === 'GoTo') {
    const d = oa.lookup(PDFName.of('D'))
    if (d instanceof PDFArray) return { array: d, foreign: false }
  }
  return { array: null, foreign: true }
}

export async function readViewPrefs(bytes: Uint8Array): Promise<ViewPrefs> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const out: ViewPrefs = { ...DEFAULT_VIEW_PREFS, printRange: [] }
  const layout = nameOf(doc.catalog.lookup(PDFName.of('PageLayout')))
  if (layout && (LAYOUTS as string[]).includes(layout)) out.layout = layout as PageLayoutName
  const mode = nameOf(doc.catalog.lookup(PDFName.of('PageMode')))
  if (mode && (MODES as string[]).includes(mode)) out.pageMode = mode as PageModeName

  const { array, foreign } = openDestination(doc)
  out.foreignOpenAction = foreign
  if (array && array.size() >= 2) {
    const target = array.get(0)
    const pages = doc.getPages()
    if (target instanceof PDFRef) {
      const i = pages.findIndex((p) => p.ref.tag === target.tag)
      if (i >= 0) out.openPage = i + 1
    } else {
      const n = numOf(target) // a remote-style destination uses a page number from 0
      if (n !== null && n >= 0 && n < pages.length) out.openPage = Math.floor(n) + 1
    }
    const kind = nameOf(array.get(1))
    if (kind === 'Fit') out.magnification = { kind: 'fit-page' }
    else if (kind === 'FitH') out.magnification = { kind: 'fit-width' }
    else if (kind === 'FitBH' || kind === 'FitB') out.magnification = { kind: 'fit-visible' }
    else if (kind === 'XYZ') {
      const z = numOf(array.get(4))
      if (z !== null && z > 0) out.magnification = { kind: 'zoom', percent: Math.round(z * 100) }
    }
  }

  const vp = doc.catalog.lookup(PDFName.of('ViewerPreferences'))
  const prefs = vp instanceof PDFDict ? vp : undefined
  out.hideToolbar = flag(prefs, 'HideToolbar')
  out.hideMenubar = flag(prefs, 'HideMenubar')
  out.hideWindowUI = flag(prefs, 'HideWindowUI')
  out.fitWindow = flag(prefs, 'FitWindow')
  out.centreWindow = flag(prefs, 'CenterWindow')
  out.displayTitle = flag(prefs, 'DisplayDocTitle')
  out.pickTray = flag(prefs, 'PickTrayByPDFSize')
  if (nameOf(prefs?.lookup(PDFName.of('PrintScaling'))) === 'None') out.printScaling = 'None'
  const dup = nameOf(prefs?.lookup(PDFName.of('Duplex')))
  if (dup && (DUPLEXES as string[]).includes(dup)) out.duplex = dup as DuplexName
  const copies = numOf(prefs?.lookup(PDFName.of('NumCopies')))
  if (copies !== null && copies >= 1 && copies <= 5) out.numCopies = Math.round(copies)
  const base = doc.catalog.lookupMaybe(PDFName.of('URI'), PDFDict)?.lookup(PDFName.of('Base'))
  if (base instanceof PDFString || base instanceof PDFHexString) out.baseUrl = base.decodeText()
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  const trapped = info?.lookup(PDFName.of('Trapped'))
  const trappedName = trapped instanceof PDFName ? trapped.decodeText() : trapped instanceof PDFBool ? (trapped.asBoolean() ? 'True' : 'False') : ''
  if (trappedName === 'True' || trappedName === 'False') out.trapped = trappedName
  const range = prefs?.lookup(PDFName.of('PrintPageRange'))
  if (range instanceof PDFArray) {
    for (let i = 0; i + 1 < range.size(); i += 2) {
      const a = numOf(range.lookup(i))
      const b = numOf(range.lookup(i + 1))
      if (a !== null && b !== null && a >= 1 && b >= a) out.printRange.push([Math.floor(a), Math.floor(b)])
    }
  }
  return out
}

/** Writes the entries (an unset one is removed); returns the new file. */
export async function writeViewPrefs(bytes: Uint8Array, v: ViewPrefs): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const cat = doc.catalog
  const setName = (key: string, value: string | null) => (value ? cat.set(PDFName.of(key), PDFName.of(value)) : cat.delete(PDFName.of(key)))
  setName('PageLayout', v.layout === 'Default' ? null : v.layout)
  setName('PageMode', v.pageMode === 'Default' ? null : v.pageMode)

  const { foreign } = openDestination(doc)
  if (!foreign) {
    const pages = doc.getPages()
    const index = Math.min(pages.length, Math.max(1, Math.round(v.openPage))) - 1
    const m = v.magnification
    // A script chained after the open action (see docActions.ts) stays.
    const old = cat.lookup(PDFName.of('OpenAction'))
    const next = old instanceof PDFDict ? old.get(PDFName.of('Next')) : undefined
    if (m.kind === 'default' && index === 0 && !next) cat.delete(PDFName.of('OpenAction'))
    else if (pages.length) {
      const ref = pages[index].ref
      const dest =
        m.kind === 'fit-page'
          ? ctx.obj([ref, PDFName.of('Fit')])
          : m.kind === 'fit-width'
            ? ctx.obj([ref, PDFName.of('FitH'), null])
            : m.kind === 'fit-visible'
              ? ctx.obj([ref, PDFName.of('FitBH'), null])
              : ctx.obj([ref, PDFName.of('XYZ'), null, null, m.kind === 'zoom' ? Math.max(0.01, m.percent / 100) : null])
      cat.set(PDFName.of('OpenAction'), next ? ctx.obj({ S: 'GoTo', D: dest, Next: next }) : dest)
    }
  }

  const base = v.baseUrl.trim()
  if (base) {
    const uri = cat.lookupMaybe(PDFName.of('URI'), PDFDict) ?? (ctx.obj({}) as PDFDict)
    uri.set(PDFName.of('Base'), PDFString.of(base))
    cat.set(PDFName.of('URI'), uri)
  } else {
    const uri = cat.lookupMaybe(PDFName.of('URI'), PDFDict)
    uri?.delete(PDFName.of('Base'))
    if (uri && !uri.keys().length) cat.delete(PDFName.of('URI'))
  }
  const info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict)
  if (v.trapped !== 'Unknown') {
    const target =
      info ??
      (() => {
        const ref = ctx.register(ctx.obj({}))
        ctx.trailerInfo.Info = ref
        return ctx.lookup(ref, PDFDict)
      })()
    target.set(PDFName.of('Trapped'), PDFName.of(v.trapped))
  } else info?.delete(PDFName.of('Trapped'))

  const existing = cat.lookup(PDFName.of('ViewerPreferences'))
  const prefs = existing instanceof PDFDict ? existing : ctx.obj({})
  const put = (key: string, on: boolean) => (on ? prefs.set(PDFName.of(key), PDFBool.True) : prefs.delete(PDFName.of(key)))
  put('HideToolbar', v.hideToolbar)
  put('HideMenubar', v.hideMenubar)
  put('HideWindowUI', v.hideWindowUI)
  put('FitWindow', v.fitWindow)
  put('CenterWindow', v.centreWindow)
  put('DisplayDocTitle', v.displayTitle)
  put('PickTrayByPDFSize', v.pickTray)
  if (v.printScaling === 'None') prefs.set(PDFName.of('PrintScaling'), PDFName.of('None'))
  else prefs.delete(PDFName.of('PrintScaling'))
  if (v.duplex === 'Default') prefs.delete(PDFName.of('Duplex'))
  else prefs.set(PDFName.of('Duplex'), PDFName.of(v.duplex))
  if (v.numCopies >= 2 && v.numCopies <= 5) prefs.set(PDFName.of('NumCopies'), PDFNumber.of(Math.round(v.numCopies)))
  else prefs.delete(PDFName.of('NumCopies'))
  if (v.printRange.length) prefs.set(PDFName.of('PrintPageRange'), ctx.obj(v.printRange.flat()))
  else prefs.delete(PDFName.of('PrintPageRange'))
  if (prefs.keys().length) cat.set(PDFName.of('ViewerPreferences'), prefs)
  else cat.delete(PDFName.of('ViewerPreferences'))
  return doc.save()
}

/** "1-3, 5" for [[1,3],[5,5]]. */
export function printRangeText(r: [number, number][]): string {
  return r.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(', ')
}

/** "1-3, 5" to ranges from 1, kept within the page count. Throws a message the dialog can show. */
export function parsePrintRange(text: string, pageCount: number): [number, number][] {
  const out: [number, number][] = []
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!m) throw new Error(`"${part}" is not a page or a range such as 2-4`)
    const a = Number(m[1])
    const b = m[2] === undefined ? a : Number(m[2])
    if (a < 1 || b < a || b > pageCount) throw new Error(`"${part}" is outside pages 1 to ${pageCount}`)
    out.push([a, b])
  }
  return out
}

/** The paper size (A5 to A1, Letter and so on) a page of this size fits, to within about 2 mm, in either orientation. */
export function matchPaper(page: { width: number; height: number }): PaperId | null {
  const tol = 6
  const [pa, pb] = [Math.min(page.width, page.height), Math.max(page.width, page.height)]
  for (const id of Object.keys(PAPER_SIZES) as PaperId[]) {
    const { w, h } = PAPER_SIZES[id]
    if (Math.abs(Math.min(w, h) - pa) <= tol && Math.abs(Math.max(w, h) - pb) <= tol) return id
  }
  return null
}

/** What the Print dialog starts with, from the document's print presets. `any` is false when the file sets none. */
export interface PrintDefaults {
  copies: number
  duplex: 'off' | 'long' | 'short'
  scaling: 'fit' | 'actual'
  /** A page range in the dialog's own text form, or '' for all pages. */
  rangeText: string
  paper: PaperId | null
  any: boolean
}

export function printDefaults(v: ViewPrefs, pageCount: number, firstPage?: { width: number; height: number }): PrintDefaults {
  const duplex = v.duplex === 'DuplexFlipLongEdge' ? 'long' : v.duplex === 'DuplexFlipShortEdge' ? 'short' : 'off'
  const inRange = v.printRange.length > 0 && v.printRange.every(([, b]) => b <= pageCount)
  const out: PrintDefaults = {
    copies: v.numCopies,
    duplex,
    scaling: v.printScaling === 'None' ? 'actual' : 'fit',
    rangeText: inRange ? printRangeText(v.printRange) : '',
    paper: v.pickTray && firstPage ? matchPaper(firstPage) : null,
    any: false
  }
  out.any = out.copies > 1 || v.duplex !== 'Default' || out.scaling === 'actual' || out.rangeText !== '' || out.paper !== null
  return out
}

/** What the viewer should do on opening, from the prefs; a field is undefined when the file says nothing. */
export interface OpenView {
  twoUp?: boolean
  continuous?: boolean
  cover?: boolean
  zoom?: 'fit-width' | 'fit-page' | 'fit-visible' | number
  /** Side pane to show; null closes it. */
  sidebar?: 'pages' | 'bookmarks' | 'attachments' | 'layers' | null
  /** 0-based. */
  page?: number
  hideToolbar: boolean
  displayTitle: boolean
}

export function openViewFrom(v: ViewPrefs): OpenView {
  const out: OpenView = { hideToolbar: v.hideToolbar || v.hideWindowUI, displayTitle: v.displayTitle }
  switch (v.layout) {
    case 'SinglePage':
      Object.assign(out, { twoUp: false, continuous: false, cover: false })
      break
    case 'OneColumn':
      Object.assign(out, { twoUp: false, continuous: true, cover: false })
      break
    case 'TwoColumnLeft':
      Object.assign(out, { twoUp: true, continuous: true, cover: false })
      break
    case 'TwoColumnRight':
      Object.assign(out, { twoUp: true, continuous: true, cover: true })
      break
    case 'TwoPageLeft':
      Object.assign(out, { twoUp: true, continuous: false, cover: false })
      break
    case 'TwoPageRight':
      Object.assign(out, { twoUp: true, continuous: false, cover: true })
      break
  }
  const m = v.magnification
  if (m.kind === 'fit-page' || m.kind === 'fit-width' || m.kind === 'fit-visible') out.zoom = m.kind
  else if (m.kind === 'zoom') out.zoom = m.percent / 100
  if (v.pageMode === 'UseNone') out.sidebar = null
  else if (v.pageMode === 'UseOutlines') out.sidebar = 'bookmarks'
  else if (v.pageMode === 'UseThumbs') out.sidebar = 'pages'
  else if (v.pageMode === 'UseAttachments') out.sidebar = 'attachments'
  else if (v.pageMode === 'UseOC') out.sidebar = 'layers'
  if (v.openPage > 1) out.page = v.openPage - 1
  return out
}
