import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FONT_SIZE,
  NOTE_SIZE,
  TEXTBOX_DEFAULT,
  annotLabel,
  colorChoices,
  DEFAULT_LINE_WIDTH,
  LINE_WIDTHS,
  STAMP_LABELS,
  defaultColor,
  isShapeKind,
  isMarkup,
  hasFont,
  type ToolStyle,
  eraseFromPaths,
  canDash,
  canFill,
  signature,
  type Reply,
  type ReviewState,
  stampSize,
  parseWav,
  imageStampSize,
  stampInfoLine,
  TEXTBOX_PADDING,
  translated,
  typewriterRect,
  withBounds,
  type Annot,
  type AnnotKind,
  type Pt
} from './annotations'
import { writeAnnotations, type DeletedAnnot } from './annotWrite'
import {
  bookmarkRanges,
  deletePages,
  duplicatePages,
  extractPages,
  insertPagesFrom,
  movePages,
  parsePageRanges,
  replacePages,
  rotatePages,
  splitByRanges,
  splitBySize,
  splitEvery,
  type Part
} from './pageOps'
import { getPageClip, onPageClip, setPageClip } from './pageClipboard'
import { PDFDocument } from 'pdf-lib'
import { PdfClient, type AttachmentInfo, type OutlineNode, type PageSize } from './pdfClient'
import { Sidebar, type PageOp, type SidebarTab } from './Sidebar'
import { findInPage, hitTest, normaliseNewlines, rangeRects, type Match } from './textLogic'
import { BatchDialog } from './BatchDialog'
import { appEnv, describeDocument, runSteps } from './batch'
import { PluginsDialog } from './PluginsDialog'
import { normaliseResult } from '../../shared/plugins'
import { runPluginScript } from './pluginSandbox'
import { PortfolioDialog } from './PortfolioDialog'
import { createPortfolio, embedFiles, isPortfolio, removeEmbedded } from './portfolio'
import { CompareDocsDialog } from './CompareDocsDialog'
import { CreateDialog, type CreateRequest } from './CreateDialog'
import { imagesToPdf, textToPdf } from './createPdf'
import { ScanDialog, type ScanRequest } from './ScanDialog'
import { OcrDialog, type OcrRequest } from './OcrDialog'
import { addTextLayer, ocrDocument, type OcrInput } from './ocrLayer'
import { ExportImagesDialog, type ExportImagesRequest } from './ExportDialog'
import { bodySize, encodePage, pageFileName, scaleFor, structurePage, toDocx, toHtml, type ExportBlock } from './exportDoc'
import { groupBlocks } from './textBlocks'
import { SanitiseDialog } from './SanitiseDialog'
import { StandardsDialog } from './StandardsDialog'
import { convertToPdfA, type PdfAReport } from './pdfa'
import { checkStandards, type StandardsReport } from './standards'
import { SignDialog, type SignRequest } from './SignDialog'
import { SignaturesDialog, signatureState, type SignatureRow } from './SignaturesDialog'
import { addTimestamp, buildTimestampRequest, prepareSignature, readSignatures, verifySignature } from './sign'
import { sanitise, scanHidden, type HiddenInfo } from './sanitise'
import { redactPages, type RedactMark, type RedactReport } from './redact'
import { useHistory } from './useHistory'
import { DEFAULT_MODE, layoutRows, rowExtent, type PageMode } from './pageLayout'
import { GAP, PAD, Viewer, type Tool, type ViewAids, type ViewerHandle } from './Viewer'
import type { Guide } from './GuideLayer'
import { encodeRotatedPng, printDocument } from './print'
import type { SearchJump } from './SearchPanel'
import { Presentation } from './Presentation'
import { annotsFromImported } from './importMap'
import { addBackground, addHeaderFooter, addWatermark, cropPages, marksPresent, removeMarks, resizePages, uncropPages, type MarkKind } from './pageMarks'
import { PageMarksDialog, type MarksMode, type MarksRequest } from './PageMarksDialog'
import { readLabelRanges, writeLabelRanges, writeOutline, type BookmarkNode, type LabelRange } from './outlineEdit'
import { PageLabelsDialog } from './PageLabelsDialog'
import { optimise, type OptimiseOptions } from './optimise'
import { readProps, removeProps, writeProps, type DocProps } from './metadata'
import { replaceBlock, weightAndSlant } from './textEdit'
import { addImage, replaceImage, transformImage } from './imageEdit'
import { transformPath } from './pathEdit'
import { alignAnnots, distributeAnnots, restack, type AlignMode, type StackMode } from './arrange'
import { applyFormValues, flattenForm, readForm, type FieldType, type FormField, type FormValue } from './forms'
import { detectInDocument, type Detected } from './formDetect'
import { DetectDialog } from './DetectDialog'
import { addField, addFields, deleteField, moveInTabOrder, placeWidget, setTabOrder, updateField, type FieldPatch, type FieldSpec, type TabOrder } from './formDesign'
import { FieldDialog } from './FieldDialog'
import { describeRestrictions, restrictsEditing, type EncryptOptions, type Permissions } from '../../shared/pdfSecurity'
import { SecurityDialog } from './SecurityDialog'
import { Modal } from './AppDialogs'
import { commitValue, displayValue, fieldStates, recalculate, runScript } from './formScripts'
import { entriesFor, readDataFile, toCsv, toFdfData, toXfdfData, toXml, valuesFromImport, type DataFormat } from './formData'
import { DocPropsDialog } from './DocPropsDialog'
import { formatSize, OptimiseDialog } from './OptimiseDialog'
import { compareAnnots, takeTheirs, type Comparison } from './compareAnnots'
import { ComparePanel } from './ComparePanel'
import { PropertiesPanel, type ToolPreset } from './PropertiesPanel'
import { CommentsPane } from './CommentsPane'
import { commentsCsv, commentSummaryPdf } from './commentReport'
import { fromFdf, fromNorms, fromXfdf, pageFrames, toFdf, toNorms, toXfdf } from './interchange'
import { StampPicker, type StampChoice } from './StampPicker'
import type { ImageStamp } from '../../preload'
import { Reader, type ReaderState } from './readAloud'
import type { MeasureKind } from './MeasureLayer'
import { calibrate, formatArea, formatLength, pathLength, PAPER_MM, polygonArea, readViewports, scaleAt, type Scale, type Viewport } from './measure'
import { readLayers, withHiddenLayers, type Layer } from './layers'
import {
  ArrowLeftRight,
  BookOpen,
  Camera,
  Columns2,
  FileText,
  GalleryVertical,
  ScanSearch,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Expand,
  FileOutput,
  FilePlus2,
  Files,
  Tags,
  Gauge,
  ImageIcon,
  Shapes,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Hand,
  Highlighter,
  LayoutGrid,
  MousePointer2,
  MoveUpRight,
  PanelLeft,
  PanelTop,
  Hash,
  Barcode,
  Droplets,
  PaintBucket,
  Crop,
  SquareDashed,
  Maximize2,
  ClipboardPaste,
  Globe,
  CopyPlus,
  GitCompare,
  FileInput,
  Paperclip,
  Link2,
  SlidersHorizontal,
  Eraser as EraserIcon,
  Hexagon,
  Cloud,
  Keyboard,
  MessageSquareShare,
  Waves,
  Replace,
  TextCursorInput,
  Grid3x3,
  Magnet,
  Eraser,
  Ruler,
  Spline,
  Pentagon,
  Scaling,
  Pause,
  Play,
  Volume2,
  BookOpenText,
  Sun,
  Moon,
  Contrast,
  CircleStop,
  Presentation as PresentationIcon,
  PanelRight,
  Pencil,
  Printer,
  Redo2,
  RotateCcw,
  Layers2,
  ShieldCheck,
  SquareCheck,
  CircleDot,
  SquareChevronDown,
  List,
  RectangleHorizontal,
  PenLine,
  SquareDashedMousePointer,
  Rows3,
  Columns3,
  ListOrdered,
  RotateCcwSquare,
  RotateCw,
  RotateCwSquare,
  Save,
  SaveAll,
  Scan,
  Scissors,
  Search,
  Slash,
  Square,
  Stamp as StampIcon,
  StickyNote,
  Strikethrough,
  Trash2,
  Type,
  Archive,
  ListChecks,
  Puzzle,
  BadgeCheck,
  EyeOff,
  ScanLine,
  ScanText,
  FileSignature,
  ShieldAlert,
  TextSelect,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { IconButton, RB, RGroup, RStack } from './Ribbon'
import { displayDims, turn, type Rotation } from './viewRotation'

type ZoomMode = 'fit-width' | 'fit-page' | number

interface PrintChoice {
  /** 1 = one page per sheet; 'booklet' = folded booklet. */
  perSheet: 1 | 2 | 4 | 6 | 9 | 16 | 'booklet'
  range: 'all' | 'current' | 'custom'
  custom: string
  copies: number
  fit: boolean
  autoRotate: boolean
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8]
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const MAX_MATCHES = 5000

export interface DocMeta {
  dirty?: boolean
  name?: string
  path?: string
}

interface Props {
  id: number
  data: Uint8Array
  name: string
  path?: string
  active: boolean
  /** Must be a stable function; it is called from effects. */
  onMeta: (id: number, meta: DocMeta) => void
  /** Restored from a crash-recovery snapshot: starts out unsaved. */
  recovered?: boolean
  /** Minutes between crash-recovery snapshots; 0 turns them off. */
  autosaveMinutes: number
  sidebarWidth: number
  paneSide: 'left' | 'right'
  onPaneSide: (side: 'left' | 'right') => void
  /** Called when the user finishes dragging the side pane's edge. */
  onSidebarWidth: (w: number) => void
  onOpen: () => void
  /** A new document made here (from pictures, text and so on) opens in a tab of its own, unsaved. */
  onNewDoc: (name: string, data: Uint8Array) => void
  onCloseDoc: () => void
  /** Settings author name, for dated stamps. */
  author: string
  toolDefaults: Record<string, ToolStyle>
  toolPresets: ToolPreset[]
  onSettings: (patch: { toolDefaults?: Record<string, ToolStyle>; toolPresets?: ToolPreset[] }) => void
  /** A search-in-files result to show. */
  jump?: SearchJump
}

/** Whether a file has an /Encrypt entry near its start or end (where the trailer is), so only those are asked about. */
function mightBeEncrypted(data: Uint8Array): boolean {
  const look = (part: Uint8Array) => new TextDecoder('latin1').decode(part).includes('/Encrypt')
  return look(data.subarray(0, 65536)) || (data.length > 65536 && look(data.subarray(data.length - 65536)))
}

type RibbonTab = 'file' | 'home' | 'edit' | 'forms' | 'redact' | 'sign' | 'convert' | 'comment' | 'draw' | 'measure' | 'organise' | 'layout' | 'view'
const RIBBON_TABS: [RibbonTab, string][] = [
  ['file', 'File'],
  ['home', 'Home'],
  ['edit', 'Edit'],
  ['forms', 'Forms'],
  ['redact', 'Redact'],
  ['sign', 'Sign'],
  ['convert', 'Convert'],
  ['comment', 'Comment'],
  ['draw', 'Draw'],
  ['measure', 'Measure'],
  ['organise', 'Organise'],
  ['layout', 'Layout'],
  ['view', 'View']
]

/** Fill colours: light tints that keep the page readable underneath. */
const FILL_COLORS = ['#fde2e1', '#fff4c2', '#dff5e1', '#dcecff', '#efe3ff', '#ffffff']

/** Measurements are drawn in a dark red, distinct from the red of markup. */
const MEASURE_COLOR = '#b3261e'

const LENGTH_UNITS = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi']

/** Tells this window's recovery snapshots apart from those left by an earlier run. */
const SESSION = Math.random().toString(36).slice(2, 10)

/** [0,1,2,4] -> "1-3, 5" */
function compactRanges(pages: number[]): string {
  const out: string[] = []
  for (let i = 0; i < pages.length; ) {
    let j = i
    while (pages[j + 1] === pages[j] + 1) j++
    out.push(j > i ? `${pages[i] + 1}-${pages[j] + 1}` : String(pages[i] + 1))
    i = j + 1
  }
  return out.join(', ')
}

export function DocView({ id: docId, data, name, path, active, onMeta: reportMeta, recovered, autosaveMinutes, sidebarWidth, onSidebarWidth, paneSide, onPaneSide, onOpen, onNewDoc, onCloseDoc, jump, author, toolDefaults, toolPresets, onSettings }: Props) {
  const [ribbon, setRibbon] = useState<RibbonTab>('home')
  // Pages selected in the thumbnail pane; the Organise tab acts on them, or on the current page if none are.
  const [pageSel, setPageSel] = useState<number[]>([])
  const [paneWidth, setPaneWidth] = useState(sidebarWidth)
  useEffect(() => setPaneWidth(sidebarWidth), [sidebarWidth])
  const onMeta = useCallback((meta: DocMeta) => reportMeta(docId, meta), [docId, reportMeta])
  // The bytes currently shown. They change after a save, which reloads the document with the annotations baked in.
  const [bytes, setBytes] = useState(data)
  // Page edits (rotate, delete, move, insert) rewrite the whole file. Each is applied at once and the previous bytes
  // are kept so it can be undone. Pending annotation edits are written into the file first, so undoing a page edit
  // brings back the annotations as ordinary saved ones, not as editable overlay changes.
  const [savedBytes, setSavedBytes] = useState(() => (recovered ? new Uint8Array(0) : data))
  const [pageUndo, setPageUndo] = useState<Uint8Array[]>([])
  const [pageRedo, setPageRedo] = useState<Uint8Array[]>([])
  const [pageDialog, setPageDialog] = useState<
    | { kind: 'extract'; pages: number[] }
    | { kind: 'split'; pages: number[]; mode: 'count' | 'bookmarks' | 'size' }
    | { kind: 'replace'; pages: number[]; other: { name: string; data: Uint8Array }; otherCount: number; theirs: string }
    | null
  >(null)
  const [dialogText, setDialogText] = useState('')
  const [busy, setBusy] = useState(false)
  const [client, setClient] = useState<PdfClient | null>(null)
  /** The bytes the current client loaded: editing text needs the client to match the file, or its object numbers are stale. */
  const [clientBytes, setClientBytes] = useState<Uint8Array | null>(null)
  const [pages, setPages] = useState<PageSize[]>([])
  const [error, setError] = useState<string | null>(null)
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)
  const [passwordIssue, setPasswordIssue] = useState<'required' | 'wrong' | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  // ---- Security -------------------------------------------------------------------------------------
  // An encrypted file is decrypted in memory when its password is entered, so everything can be edited; it is encrypted
  // again when saved. A file whose owner restricted editing stays read-only until the owner password is entered.
  /** Why the document cannot be changed (the owner's restrictions), or null. */
  const [lockReason, setLockReason] = useState<string | null>(null)
  const locked = lockReason !== null
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  type Protection = { kind: 'none' } | { kind: 'copy'; original: Uint8Array; password: string } | { kind: 'new'; options: EncryptOptions }
  const [protection, setProtection] = useState<Protection>({ kind: 'none' })
  /** The protection was changed here and must be written on save. */
  const [protectionDirty, setProtectionDirty] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [ownerPrompt, setOwnerPrompt] = useState<{ draft: string; wrong: boolean } | null>(null)
  const [tool, setTool] = useState<Tool>('select')

  const [mode, setMode] = useState<ZoomMode>('fit-width')
  // View-only rotation for this tab. It never touches the bytes, so it cannot mark the document unsaved.
  const [rotation, setRotation] = useState<Rotation>(0)
  const rotateView = useCallback((dir: 1 | -1) => setRotation((r) => turn(r, dir)), [])
  const [pageMode, setPageMode] = useState<PageMode>(DEFAULT_MODE)
  const zoomTo = useCallback((z: number) => setMode(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))), [])

  /** Snapshot tool: render the box at 200 dpi (as it is displayed, rotation included) and copy it as an image. */
  const takeSnapshot = async (page: number, rect: { x: number; y: number; w: number; h: number }) => {
    const c = clientRef.current
    if (!c) return
    try {
      const scale = Math.min(200 / 72, Math.sqrt(30_000_000 / (rect.w * rect.h)))
      const region = { x: Math.floor(rect.x * scale), y: Math.floor(rect.y * scale), w: Math.max(1, Math.round(rect.w * scale)), h: Math.max(1, Math.round(rect.h * scale)) }
      const out = await c.render(page, scale, { region })
      const png = await encodeRotatedPng(out.width, out.height, out.data, rotation)
      await window.openpdf.copyImage(png)
      const turned = rotation === 90 || rotation === 270
      setNotice({ kind: 'info', text: `Snapshot copied to the clipboard (${turned ? out.height : out.width} × ${turned ? out.width : out.height} pixels)` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not take the snapshot: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [currentPage, setCurrentPage] = useState(0)
  const [sidebar, setSidebar] = useState<SidebarTab | null>('pages')
  const viewer = useRef<ViewerHandle>(null)

  // ---- Layers ---------------------------------------------------------------------------------------
  // Hiding a layer is view-only: the viewer loads a copy whose default layer state is rewritten. Such a reload
  // keeps the annotation edit state (viewOnlyReload).
  const [layers, setLayers] = useState<Layer[]>([])
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<string> | null>(null)
  const [viewBytes, setViewBytes] = useState(bytes)
  const viewOnlyReload = useRef(false)
  const lastBytes = useRef(bytes)
  useEffect(() => {
    let cancelled = false
    if (bytes !== lastBytes.current) {
      // New file contents (save, page edit): layer choices start again from the document's defaults.
      lastBytes.current = bytes
      setHiddenLayers(null)
      setViewBytes(bytes)
      return
    }
    if (!hiddenLayers) {
      setViewBytes(bytes)
      return
    }
    withHiddenLayers(bytes, hiddenLayers)
      .then((copy) => {
        if (cancelled) return
        viewOnlyReload.current = true
        setViewBytes(copy)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [bytes, hiddenLayers])
  useEffect(() => {
    let cancelled = false
    readLayers(bytes).then((l) => !cancelled && setLayers(l))
    return () => {
      cancelled = true
    }
  }, [bytes])
  const toggleLayer = (key: string) => {
    const now = hiddenLayers ?? new Set(layers.filter((l) => !l.defaultOn).map((l) => l.key))
    const next = new Set(now)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setHiddenLayers(next)
  }

  const [attachments, setAttachments] = useState<AttachmentInfo[]>([])
  const saveAttachment = async (a: AttachmentInfo) => {
    try {
      const data = await clientRef.current!.attachmentData(a.index, a.page)
      const saved = await window.openpdf.saveAttachment(a.name, data)
      if (saved) setNotice({ kind: 'info', text: `Saved ${saved}` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not save the attachment: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const [portfolioFiles, setPortfolioFiles] = useState<{ name: string; data: Uint8Array }[] | null>(null)
  const addAttachments = async () => {
    const files = await window.openpdf.pickFiles()
    if (files.length) await applyPageEdit((b) => embedFiles(b, files.map((f) => ({ name: f.name, data: f.data, modified: new Date() }))), `Attached ${files.length} file${files.length === 1 ? '' : 's'} to the document`)
  }
  const removeAttachment = (a: AttachmentInfo) =>
    void applyPageEdit(async (b) => {
      const r = await removeEmbedded(b, a.index, a.name)
      return r.removed ? r.bytes : null
    }, `Removed ${a.name}`)
  const saveAllAttachments = async () => {
    try {
      const files: { name: string; data: Uint8Array }[] = []
      for (const a of attachments) files.push({ name: a.name, data: await clientRef.current!.attachmentData(a.index, a.page) })
      const saved = await window.openpdf.saveFiles(files)
      if (saved) setNotice({ kind: 'info', text: `Saved ${files.length} file${files.length === 1 ? '' : 's'} in ${saved.dir}` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not save the files: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const [pageLabels, setPageLabels] = useState<string[] | null>(null)
  const [labelRanges, setLabelRanges] = useState<LabelRange[] | null>(null)
  const [optimising, setOptimising] = useState(false)
  const [docProps, setDocProps] = useState<DocProps | null>(null)
  const [standards, setStandards] = useState<StandardsReport | null>(null)
  const [conversion, setConversion] = useState<PdfAReport | undefined>(undefined)
  const makePdfA = async () => {
    let done: { report: StandardsReport; conv: PdfAReport } | null = null
    await applyPageEdit(async (b) => {
      const r = await convertToPdfA(b, async (family, bold, italic) => (await window.openpdf.findFont(family, bold, italic).catch(() => null))?.data ?? null)
      done = { report: await checkStandards(r.bytes), conv: r.report }
      return r.bytes
    })
    if (done) {
      const d = done as { report: StandardsReport; conv: PdfAReport }
      setConversion(d.conv)
      setStandards(d.report)
    }
  }
  const openStandards = async () => {
    try {
      setStandards(await checkStandards(annotsDirty ? await applyEdits(bytes) : bytes))
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not check the document: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const openDocProps = async () => {
    try {
      setDocProps(await readProps(bytes))
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not read the document properties: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const openPageLabels = async () => {
    try {
      setLabelRanges(await readLabelRanges(bytes))
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not read the page labels: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  useEffect(() => {
    const c = new PdfClient()
    let cancelled = false
    c.load(viewBytes)
      .then((p) => {
        if (cancelled) return
        setPasswordIssue(null)
        setPages(p)
        setClient(c)
        setClientBytes(viewBytes)
        c.outline()
          .then((o) => !cancelled && setOutline(o))
          .catch(() => !cancelled && setOutline([]))
        c.attachments()
          .then((a) => !cancelled && setAttachments(a))
          .catch(() => !cancelled && setAttachments([]))
        c.pageLabels()
          .then((l) => !cancelled && setPageLabels(l.some((x) => x) ? l : null))
          .catch(() => !cancelled && setPageLabels(null))
      })
      .catch((e: Error) => {
        if (cancelled) return
        if (/password/i.test(e.message)) setPasswordIssue('required')
        else setError(`Could not open this PDF: ${e.message}`)
      })
    return () => {
      cancelled = true
      c.dispose()
    }
  }, [viewBytes])

  /** Opens an encrypted file with `pw`: decrypts it in memory and remembers how to protect it again on save. Returns false for a wrong password. */
  const unlock = async (pw: string): Promise<boolean> => {
    const info = await window.openpdf.encryptionInfo(data, pw)
    if (info.state !== 'open') return false
    const plain = await window.openpdf.decryptPdf(data, pw)
    setBytes(plain)
    setSavedBytes(plain)
    setProtection({ kind: 'copy', original: data, password: pw })
    setPermissions(info.permissions ?? null)
    setLockReason(info.permissions && restrictsEditing(info.permissions) && !info.ownerPassword ? `The owner of this document does not allow: ${describeRestrictions(info.permissions)}.` : null)
    setPasswordIssue(null)
    return true
  }
  // A file protected only by restrictions opens without a password; find that out, and decrypt it so it can be shown and edited.
  useEffect(() => {
    if (!mightBeEncrypted(data)) return
    let cancelled = false
    window.openpdf
      .encryptionInfo(data)
      .then((info) => {
        if (!cancelled && info.state === 'open') void unlock('')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  /** Lifts the owner's restrictions with the owner (permissions) password. */
  const unlockOwner = async (pw: string) => {
    const original = protection.kind === 'copy' ? protection.original : data
    const info = await window.openpdf.encryptionInfo(original, pw)
    if (info.state !== 'open' || !info.ownerPassword) return setOwnerPrompt({ draft: pw, wrong: true })
    setProtection({ kind: 'copy', original, password: pw })
    setLockReason(null)
    setOwnerPrompt(null)
    setNotice({ kind: 'info', text: 'Unlocked. The restrictions stay in the file when you save.' })
  }
  /** Writes the file as the protection says: unchanged (none), as it was opened (copy), or with new settings. */
  const protect = async (plain: Uint8Array): Promise<Uint8Array> => {
    if (protection.kind === 'copy') return window.openpdf.copyEncryption(plain, protection.original, protection.password)
    if (protection.kind === 'new') return window.openpdf.encryptPdf(plain, protection.options)
    return plain
  }

  const onSize = useCallback((w: number, h: number) => setSize((s) => (s.w === w && s.h === h ? s : { w, h })), [])

  const zoom = useMemo(() => {
    if (typeof mode === 'number') return mode
    if (!pages.length || !size.w) return 1
    const shown = pages.map((p) => displayDims(p, rotation))
    const { maxWidth, maxHeight } = rowExtent(layoutRows(pages.length, pageMode), shown, 0)
    const gaps = pageMode.twoUp ? GAP : 0 // pixels between the two pages of a row
    const byWidth = (size.w - 2 * PAD - gaps) / maxWidth
    const z = mode === 'fit-width' ? byWidth : Math.min(byWidth, (size.h - 2 * PAD) / maxHeight)
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
  }, [mode, pages, size, rotation, pageMode])

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const next =
        dir > 0
          ? ZOOM_STEPS.find((s) => s > zoom + 0.005) ?? MAX_ZOOM
          : [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.005) ?? MIN_ZOOM
      setMode(next)
    },
    [zoom]
  )

  const goTo = useCallback((i: number) => viewer.current?.scrollToPage(i), [])

  // ---- Annotations ----------------------------------------------------------------------------------
  const history = useHistory<Annot[]>([])
  const annots = history.present
  const [selectedAnnot, setSelectedAnnot] = useState<number | null>(null)
  /** Annotations selected along with `selectedAnnot` (Shift or Ctrl click). */
  const [extraSel, setExtraSel] = useState<ReadonlySet<number>>(new Set())
  /** The stacking order was changed and must be written on save. */
  const [zDirty, setZDirty] = useState(false)

  // ---- Form fields ----------------------------------------------------------------------------------
  const [formFields, setFormFields] = useState<FormField[]>([])
  /** Values typed into fields since the file was last written: name to value. */
  const [formValues, setFormValues] = useState<ReadonlyMap<string, FormValue>>(new Map())
  const [highlightFields, setHighlightFields] = useState(true)
  // Designing: the kind of field being drawn, the box just drawn (waiting for its properties), the field whose properties are open, the selection.
  const [fieldKind, setFieldKind] = useState<FieldType>('text')
  const [fieldDraft, setFieldDraft] = useState<{ type: FieldType; page: number; rect: { x: number; y: number; w: number; h: number } } | null>(null)
  const [fieldEdit, setFieldEdit] = useState<string | null>(null)
  const [designSel, setDesignSel] = useState<{ name: string; widget: number } | null>(null)
  /** Fields found on the pages, waiting for the user to choose which to create (null: not looking). */
  const [detected, setDetected] = useState<Detected[] | null>(null)
  const formFieldsRef = useRef<FormField[]>([])
  formFieldsRef.current = formFields
  const setFormValue = useCallback((name: string, v: FormValue) => {
    setFormValues((prev) => {
      const f = formFieldsRef.current.find((x) => x.name === name)
      const next = new Map(prev)
      if (f && JSON.stringify(f.initial) === JSON.stringify(v)) next.delete(name)
      else next.set(name, v)
      return next
    })
  }, [])
  // ---- Form scripts ---------------------------------------------------------------------------------
  const formValuesRef = useRef<ReadonlyMap<string, FormValue>>(formValues)
  formValuesRef.current = formValues
  /** The value each field last had accepted, to go back to when a check rejects a new one. */
  const committedRef = useRef(new Map<string, FormValue>())
  /** What fields with a format script show when they are not being edited. */
  const [displayed, setDisplayed] = useState<ReadonlyMap<string, string>>(new Map())
  const computeDisplays = async (fields: FormField[], values: ReadonlyMap<string, FormValue>) => {
    const withFormat = fields.filter((f) => f.scripts?.format && (f.type === 'text' || f.type === 'dropdown'))
    if (!withFormat.length) return new Map<string, string>()
    const states = fieldStates(fields, values)
    const entries = await Promise.all(
      withFormat.map(async (f): Promise<[string, string]> => {
        const v = values.get(f.name) ?? f.value
        return [f.name, await displayValue(f, typeof v === 'string' ? v : '', states)]
      })
    )
    return new Map(entries)
  }
  useEffect(() => {
    if (!formFields.some((f) => f.scripts?.format)) {
      setDisplayed((d) => (d.size ? new Map() : d))
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      computeDisplays(formFields, formValues)
        .then((m) => !cancelled && setDisplayed(m))
        .catch(() => {})
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [formFields, formValues]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Runs the calculate scripts for `values`, applies what changed, and reports messages from the scripts. */
  const applyCalculations = async (values: ReadonlyMap<string, FormValue>) => {
    const fields = formFieldsRef.current
    if (!fields.some((f) => f.scripts?.calculate)) return
    const res = await recalculate(fields, values)
    for (const [n, v] of res.changed) {
      committedRef.current.set(n, v)
      setFormValue(n, v)
    }
    if (res.error) setNotice({ kind: 'error', text: `A calculation could not run: ${res.error}` })
    else if (res.alerts.length) setNotice({ kind: 'info', text: res.alerts.join(' ') })
  }
  /** A value was committed to a field (a text field lost focus, or another control changed): check it, then recalculate. */
  const commitField = async (f: FormField, v: FormValue) => {
    let value = v
    const raw = typeof v === 'string' ? v : ''
    if ((f.type === 'text' || f.type === 'dropdown') && (f.scripts?.keystroke || f.scripts?.validate)) {
      const r = await commitValue(f, raw, fieldStates(formFieldsRef.current, new Map(formValuesRef.current).set(f.name, v)))
      if (r.error) setNotice({ kind: 'error', text: `The script for "${f.name}" could not run: ${r.error}` })
      else if (r.alerts.length) setNotice({ kind: r.ok ? 'info' : 'error', text: r.alerts.join(' ') })
      if (!r.ok) {
        setFormValue(f.name, committedRef.current.get(f.name) ?? f.initial)
        return
      }
      if (r.value !== raw) {
        value = r.value
        setFormValue(f.name, r.value)
      }
    }
    if (JSON.stringify(committedRef.current.get(f.name) ?? f.initial) === JSON.stringify(value)) return
    committedRef.current.set(f.name, value)
    await applyCalculations(new Map(formValuesRef.current).set(f.name, value))
  }
  /** Form data out: the fields' current values as FDF, XFDF, CSV or XML. */
  const exportFormData = async (format: DataFormat) => {
    try {
      const entries = entriesFor(formFields, formValues)
      const suggested = `${name.replace(/\.pdf$/i, '')} (form data).${format}`
      let saved: string | null
      if (format === 'csv') saved = await window.openpdf.saveText(suggested, toCsv(entries), { name: 'CSV (comma separated)', ext: 'csv' })
      else {
        const data = format === 'fdf' ? toFdfData(entries, name) : new TextEncoder().encode(format === 'xfdf' ? toXfdfData(entries, name) : toXml(entries))
        saved = await window.openpdf.saveData(suggested, data, { name: format.toUpperCase(), ext: format })
      }
      if (saved) setNotice({ kind: 'info', text: `Exported ${entries.length} field${entries.length === 1 ? '' : 's'} to ${saved}` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not export the form data: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  /** Form data in: fills matching fields (not yet saved). */
  const importFormData = async () => {
    const file = await window.openpdf.pickFile({ name: 'Form data (FDF, XFDF, CSV, XML)', ext: ['fdf', 'xfdf', 'csv', 'xml'] })
    if (!file) return
    try {
      const incoming = valuesFromImport(formFields, await readDataFile(file.name, file.data))
      setFormValues((prev) => {
        const next = new Map(prev)
        for (const [k, v] of incoming) {
          const f = formFields.find((x) => x.name === k)
          if (f && JSON.stringify(f.initial) === JSON.stringify(v)) next.delete(k)
          else next.set(k, v)
        }
        return next
      })
      setNotice({ kind: 'info', text: `Filled ${incoming.size} of ${formFields.filter((f) => f.type !== 'button' && f.type !== 'signature').length} fields from ${file.name}. Save to keep them.` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not read the form data: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const resetForm = () => {
    const empty = (f: FormField): FormValue => (f.type === 'checkbox' ? false : f.type === 'list' ? [] : '')
    const next = new Map<string, FormValue>()
    for (const f of formFields) {
      if (f.readOnly || f.type === 'button' || f.type === 'signature') continue
      const e = empty(f)
      if (JSON.stringify(e) !== JSON.stringify(f.initial)) next.set(f.name, e)
    }
    setFormValues(next)
    setNotice({ kind: 'info', text: 'Form cleared. Save to keep the changes.' })
    void applyCalculations(new Map([...formValuesRef.current, ...next]))
  }
  const selectedIds = useMemo(() => new Set<number>([...(selectedAnnot !== null ? [selectedAnnot] : []), ...extraSel]), [selectedAnnot, extraSel])
  const selIdsRef = useRef<ReadonlySet<number>>(selectedIds)
  selIdsRef.current = selectedIds
  const selRef = useRef({ primary: selectedAnnot, extra: extraSel })
  selRef.current = { primary: selectedAnnot, extra: extraSel }
  const selectAnnot = useCallback((id: number | null, additive?: boolean) => {
    const { primary, extra } = selRef.current
    if (!additive || id === null) {
      setSelectedAnnot(id)
      setExtraSel(new Set())
      return
    }
    if (primary === null) {
      setSelectedAnnot(id)
      return
    }
    if (id === primary) {
      const rest = [...extra]
      setSelectedAnnot(rest[0] ?? null)
      setExtraSel(new Set(rest.slice(1)))
      return
    }
    const next = new Set(extra)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExtraSel(next)
  }, [])
  const [editingAnnot, setEditingAnnot] = useState<number | null>(null)
  const [hasTextSelection, setHasTextSelection] = useState(false)
  const [colors, setColors] = useState<Record<AnnotKind, string>>(() => {
    const kinds: AnnotKind[] = ['highlight', 'underline', 'strikeout', 'squiggly', 'caret', 'note', 'textbox', 'typewriter', 'callout', 'line', 'arrow', 'rectangle', 'ellipse', 'ink', 'polygon', 'polyline', 'cloud', 'stamp']
    return Object.fromEntries(kinds.map((k) => [k, defaultColor(k)])) as Record<AnnotKind, string>
  })
  const [drawWidth, setDrawWidth] = useState(DEFAULT_LINE_WIDTH)
  // Fill and line style chosen per shape kind, applied to new shapes.
  const [fills, setFills] = useState<Partial<Record<AnnotKind, string>>>({})
  const [dashes, setDashes] = useState<Partial<Record<AnnotKind, 'dashed' | 'dotted'>>>({})
  const [styleMap, setStyleMap] = useState<Partial<Record<AnnotKind, ToolStyle>>>({})
  const styleMapRef = useRef(styleMap)
  styleMapRef.current = styleMap
  // Saved tool defaults (Settings) seed each tool's style.
  useEffect(() => {
    const d = toolDefaults as Partial<Record<AnnotKind, ToolStyle>>
    setColors((m) => ({ ...m, ...Object.fromEntries(Object.entries(d).flatMap(([k, s]) => (s?.color ? [[k, s.color]] : []))) }))
    setFills((m) => ({ ...m, ...Object.fromEntries(Object.entries(d).map(([k, s]) => [k, s?.fill])) }))
    setDashes((m) => ({ ...m, ...Object.fromEntries(Object.entries(d).map(([k, s]) => [k, s?.dash])) }))
    setStyleMap((m) => ({ ...m, ...d }))
  }, [toolDefaults])
  const fillsRef = useRef(fills)
  fillsRef.current = fills
  const dashesRef = useRef(dashes)
  dashesRef.current = dashes
  const authorRef = useRef(author)
  authorRef.current = author
  const [stampChoice, setStampChoice] = useState<StampChoice>({ kind: 'text', label: STAMP_LABELS[0] })
  const [stampDated, setStampDated] = useState(false)
  const [stampImages, setStampImages] = useState<ImageStamp[]>([])
  const [stampPickerOpen, setStampPickerOpen] = useState(false)
  const stampChoiceRef = useRef(stampChoice)
  stampChoiceRef.current = stampChoice
  const stampDatedRef = useRef(stampDated)
  stampDatedRef.current = stampDated
  useEffect(() => {
    window.openpdf.listStamps().then(setStampImages).catch(() => {})
  }, [])
  const [lastMarkup, setLastMarkup] = useState<AnnotKind>('highlight')
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  // A portfolio opens on its list of files.
  useEffect(() => {
    void isPortfolio(data)
      .then((p) => {
        if (!p) return
        setSidebar('attachments')
        setNotice({ kind: 'info', text: 'This PDF is a portfolio: its files are in the Attachments pane.' })
      })
      .catch(() => undefined)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false)
  const nextAnnotId = useRef(1)
  const annotsRef = useRef(annots)
  annotsRef.current = annots

  // Annotations that were already in the file when it was opened. Unchanged ones stay in the file untouched.
  const baseline = useRef(new Map<number, { page: number; origin: NonNullable<Annot['origin']>; sig: string }>())
  // Replies that were already in the file, so deleting one removes it on save.
  const baselineReplies = useRef(new Map<number, { page: number; origin: NonNullable<Reply['origin']> }>())
  const [touched, setTouched] = useState<ReadonlySet<number>>(() => new Set())
  const touchedRef = useRef(touched)
  const [epoch, setEpoch] = useState(0)
  const clientRef = useRef(client)
  clientRef.current = client

  // Load the editable annotations of a freshly opened document. The first call per document also resets the
  // edit state, because saving swaps in new bytes and this runs again.
  useEffect(() => {
    if (!client) return
    let cancelled = false
    if (viewOnlyReload.current) {
      viewOnlyReload.current = false
      const hides = [...touchedRef.current].flatMap((id) => {
        const b = baseline.current.get(id)
        return b ? [client.hideAnnot(b.page, b.origin.index, b.origin.subtype)] : []
      })
      Promise.all(hides)
        .then(() => !cancelled && setEpoch((e) => e + 1))
        .catch(() => {})
      return () => {
        cancelled = true
      }
    }
    client
      .annots()
      .then((pages) => {
        if (cancelled) return
        const imported: Annot[] = []
        baseline.current = new Map()
        baselineReplies.current = new Map()
        foreignRects.current = new Map()
        for (const { page, annots: list, replies } of pages) {
          for (const a of annotsFromImported(page, list, replies, () => nextAnnotId.current++)) {
            imported.push(a)
            baseline.current.set(a.id, { page, origin: a.origin!, sig: signature(a) })
            for (const r of a.replies ?? []) baselineReplies.current.set(r.id, { page, origin: r.origin! })
          }
        }
        touchedRef.current = new Set()
        setTouched(touchedRef.current)
        history.reset([...imported, ...annotsRef.current.filter((a) => !a.origin)])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client]) // eslint-disable-line react-hooks/exhaustive-deps

  // Foreign annotations: PDFium draws them, so moving one (or undoing a move) sets its rectangle there too, and
  // deleting one hides it.
  const foreignRects = useRef(new Map<number, string>())
  useEffect(() => {
    const c = client
    if (!c) return
    let changed = false
    const jobs: Promise<unknown>[] = []
    const present = new Set<number>()
    for (const a of annots) {
      if (a.kind !== 'foreign' || !a.origin) continue
      present.add(a.id)
      const key = JSON.stringify(a.rects[0])
      const was = foreignRects.current.get(a.id)
      foreignRects.current.set(a.id, key)
      if (was !== undefined && was !== key) {
        changed = true
        jobs.push(c.setAnnotRect(a.page, a.origin.index, a.origin.subtype, a.rects[0]))
      }
    }
    for (const [id] of foreignRects.current) {
      if (present.has(id)) continue
      const b = baseline.current.get(id)
      foreignRects.current.delete(id)
      if (b) {
        changed = true
        jobs.push(c.hideAnnot(b.page, b.origin.index, b.origin.subtype))
      }
    }
    if (changed) Promise.all(jobs).then(() => setEpoch((e) => e + 1)).catch(() => {})
  }, [annots, client])

  /** Stop PDFium drawing an imported annotation so our overlay can draw its edited version. */
  const touch = useCallback((id: number) => {
    const a = annotsRef.current.find((x) => x.id === id)
    // A foreign annotation stays drawn by PDFium (it is moved there directly), so it is never hidden.
    if (!a?.origin || touchedRef.current.has(id) || a.kind === 'foreign') return
    touchedRef.current = new Set(touchedRef.current).add(id)
    setTouched(touchedRef.current)
    clientRef.current
      ?.hideAnnot(a.page, a.origin.index, a.origin.subtype)
      .then(() => setEpoch((e) => e + 1))
      .catch(() => {})
  }, [])

  const deleted = useMemo<DeletedAnnot[]>(() => {
    const present = new Set(annots.map((a) => a.id))
    const presentReplies = new Set(annots.flatMap((a) => (a.replies ?? []).map((r) => r.id)))
    return [
      ...[...baseline.current].filter(([id]) => !present.has(id)).map(([, b]) => ({ page: b.page, origin: b.origin })),
      ...[...baselineReplies.current].filter(([id]) => !presentReplies.has(id)).map(([, b]) => ({ page: b.page, origin: b.origin }))
    ]
  }, [annots])
  const changed = (a: Annot) => !a.origin || baseline.current.get(a.id)?.sig !== signature(a)
  const hasNewReplies = (a: Annot) => !!a.replies?.some((r) => !r.origin)
  // Read the form fields whenever the file contents change (not for a document locked by its owner).
  useEffect(() => {
    if (locked) {
      setFormFields([])
      return
    }
    let cancelled = false
    readForm(bytes)
      .then((f) => {
        if (cancelled) return
        committedRef.current = new Map()
        setFormFields(f)
      })
      .catch(() => !cancelled && setFormFields([]))
    return () => {
      cancelled = true
    }
  }, [bytes, locked])
  // The pages are drawn without their fields while the controls stand in for them, so draw them again when that changes.
  const hasFormFields = formFields.length > 0
  useEffect(() => setEpoch((e) => e + 1), [hasFormFields])

  const annotWork = deleted.length > 0 || annots.some(changed) || annots.some(hasNewReplies) || zDirty
  const annotsDirty = annotWork || formValues.size > 0 || protectionDirty
  /** Writes the pending annotation edits (and new replies) and filled-in form values into `src`. */
  const applyEdits = async (src: Uint8Array) => {
    let out = src
    if (annotWork) {
      // A changed stacking order needs every annotation in order, not just the changed ones.
      const list = zDirty ? annots : annots.filter((a) => changed(a) || hasNewReplies(a))
      out = await writeAnnotations(out, list, deleted, new Set(annots.filter(changed).map((a) => a.id)), zDirty)
    }
    if (formValues.size) {
      // Text the standard font cannot show (accents, non-Latin scripts) is drawn with an installed font.
      const wide = [...formValues.values()].some((v) => [v].flat().some((s) => typeof s === 'string' && [...s].some((ch) => ch.charCodeAt(0) > 0xff)))
      const unicode = wide ? await window.openpdf.findFont('Arial', false, false).catch(() => null) : null
      out = await applyFormValues(out, formValues, unicode?.data, await computeDisplays(formFields, formValues))
    }
    return out
  }
  const dirty = annotsDirty || bytes !== savedBytes
  useEffect(() => onMeta({ dirty }), [dirty, onMeta])

  // ---- Crash recovery -------------------------------------------------------------------------------
  // While there are unsaved changes, write a snapshot (annotations included) every few minutes. A save or a
  // close removes it; after a crash the app offers it back on the next start.
  const recoveryKey = `${SESSION}-${docId}`
  const snapshot = useRef<() => Promise<Uint8Array>>(async () => bytes)
  snapshot.current = async () => (annotsDirty && !locked ? applyEdits(bytes) : bytes)
  const metaRef = useRef({ name, path })
  metaRef.current = { name, path }
  useEffect(() => {
    if (!dirty) {
      void window.openpdf.recoveryClear(recoveryKey).catch(() => {})
      return
    }
    // A recovery snapshot is a plain copy: none for a protected document.
    if (!autosaveMinutes || protection.kind !== 'none') return
    const t = setInterval(() => {
      snapshot
        .current()
        .then((out) => window.openpdf.recoverySave(recoveryKey, metaRef.current, out))
        .catch(() => {})
    }, autosaveMinutes * 60_000)
    return () => clearInterval(t)
  }, [dirty, autosaveMinutes, recoveryKey, protection.kind])
  useEffect(() => () => void window.openpdf.recoveryClear(recoveryKey).catch(() => {}), [recoveryKey])

  useEffect(() => {
    if (!notice || notice.kind === 'error') return
    const t = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(t)
  }, [notice])

  const newAnnot = (kind: AnnotKind, page: number, rects: Annot['rects'], text = ''): Annot => ({
    id: nextAnnotId.current++,
    page,
    kind,
    color: colors[kind] ?? defaultColor(kind),
    rects,
    text,
    fontSize: DEFAULT_FONT_SIZE,
    lineWidth: styleMapRef.current[kind]?.lineWidth ?? 1,
    author: authorRef.current || undefined,
    created: new Date().toISOString(),
    ...extraStyle(kind)
  })
  /** Opacity, font and font size a new annotation of `kind` starts with. */
  const extraStyle = (kind: AnnotKind): Partial<Annot> => {
    const s = styleMapRef.current[kind] ?? {}
    return {
      ...(s.opacity !== undefined && s.opacity < 1 ? { opacity: s.opacity } : {}),
      ...(hasFont(kind) && s.fontFamily ? { fontFamily: s.fontFamily } : {}),
      ...(hasFont(kind) && s.fontSize ? { fontSize: s.fontSize } : {})
    }
  }

  const markSelection = useCallback(
    async (kind: AnnotKind, replace = false) => {
      const parts = (await viewer.current?.selectionRects()) ?? []
      if (!parts.length) return
      const made = parts.map((p) => newAnnot(kind, p.page, p.rects))
      // Replace text: only the last part (where the caret goes) carries the replacement.
      if (replace) made[made.length - 1].replace = true
      history.commit((list) => [...list, ...made])
      if (!replace) setLastMarkup(kind)
      setSelectedAnnot(made[made.length - 1].id)
      if (replace) setEditingAnnot(made[made.length - 1].id)
      viewer.current?.clearSelection()
    },
    [colors, history.commit] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** The picture chosen with Add image, waiting for a click on the page. */
  const pendingImage = useRef<{ data: Uint8Array; kind: 'png' | 'jpg' } | null>(null)
  const startAddImage = async () => {
    const file = await window.openpdf.pickFile({ name: 'Pictures', ext: ['png', 'jpg', 'jpeg'] })
    if (!file) return
    const d = file.data
    const kind = d[0] === 0x89 && d[1] === 0x50 ? 'png' : d[0] === 0xff && d[1] === 0xd8 ? 'jpg' : null
    if (!kind) {
      setNotice({ kind: 'error', text: 'That file is not a PNG or JPEG picture.' })
      return
    }
    pendingImage.current = { data: d, kind }
    setTool('addimage')
    setNotice({ kind: 'info', text: 'Click the page where the picture should go.' })
  }

  const place = useCallback(
    async (kind: 'note' | 'textbox' | 'stamp' | 'caret' | 'typewriter' | 'fileattach' | 'sound', page: number, x: number, y: number) => {
      const size = pages[page]
      if (!size) return
      if (kind === 'fileattach' || kind === 'sound') {
        setTool('select')
        const file = await window.openpdf.pickFile(kind === 'sound' ? { name: 'WAV sound', ext: ['wav'] } : undefined)
        if (!file) return
        if (kind === 'sound' && !parseWav(file.data)) {
          setNotice({ kind: 'error', text: 'Only uncompressed (PCM) WAV recordings can be attached as sounds.' })
          return
        }
        const a = newAnnot(kind, page, [{ x: Math.max(0, x - 10), y: Math.max(0, y - 12), w: 20, h: 24 }], '')
        a.file = file
        history.commit((list) => [...list, a])
        setSelectedAnnot(a.id)
        return
      }
      if (kind === 'typewriter') {
        // The click marks where the first line's text starts.
        const r = typewriterRect(x - TEXTBOX_PADDING, y - DEFAULT_FONT_SIZE * 0.8, '', DEFAULT_FONT_SIZE)
        const a = newAnnot('typewriter', page, [{ ...r, w: Math.max(r.w, 60) }])
        history.commit((list) => [...list, a])
        setSelectedAnnot(a.id)
        setEditingAnnot(a.id)
        setTool('select')
        return
      }
      if (kind === 'caret') {
        // Put the caret before the character under the click, sized to its line; anywhere else, a default size.
        let rect = { x: x - 4, y: y - 9, w: 8, h: 10 }
        try {
          const pt = await clientRef.current!.pageText(page)
          const ch = hitTest(pt.boxes, x, y)
          if (ch >= 0) {
            const [l, t, , b] = [pt.boxes[ch * 4], pt.boxes[ch * 4 + 1], pt.boxes[ch * 4 + 2], pt.boxes[ch * 4 + 3]]
            const h = Math.max(6, (b - t) * 0.6)
            rect = { x: l - h * 0.4, y: b - h * 0.9, w: h * 0.8, h }
          }
        } catch {
          // keep the default
        }
        const a = newAnnot('caret', page, [rect])
        history.commit((list) => [...list, a])
        setSelectedAnnot(a.id)
        setEditingAnnot(a.id)
        setTool('select')
        return
      }
      const choice = stampChoiceRef.current
      // A dated stamp records who placed it and when, at the moment it is placed.
      const info = kind === 'stamp' && choice.kind === 'text' && stampDatedRef.current ? stampInfoLine(author) : undefined
      const stamp =
        kind !== 'stamp'
          ? null
          : choice.kind === 'image'
            ? imageStampSize(choice.stamp.width, choice.stamp.height)
            : stampSize(choice.label, info)
      const w = stamp ? stamp.w : kind === 'note' ? NOTE_SIZE : TEXTBOX_DEFAULT.w
      const h = stamp ? stamp.h : kind === 'note' ? NOTE_SIZE : TEXTBOX_DEFAULT.h
      const left = stamp ? x - w / 2 : x // a stamp is placed centred on the click
      const top = stamp ? y - h / 2 : y
      const rect = { x: Math.max(0, Math.min(size.width - w, left)), y: Math.max(0, Math.min(size.height - h, top)), w, h }
      const a = newAnnot(kind, page, [rect], stamp ? (choice.kind === 'image' ? choice.stamp.name : choice.label) : '')
      if (stamp) a.lineWidth = 2
      if (stamp && choice.kind === 'image') a.image = choice.stamp.dataUrl
      if (info) a.stampInfo = info
      history.commit((list) => [...list, a])
      setSelectedAnnot(a.id)
      if (!stamp) setEditingAnnot(a.id)
      setTool('select')
    },
    [pages, colors, author, history.commit] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** Eraser: rub out ink on one page. One undo step for the whole stroke. */
  const eraseInk = useCallback(
    (page: number, trail: Pt[], radius: number) => {
      const hits = annotsRef.current.filter((a) => a.page === page && a.kind === 'ink' && a.points && eraseFromPaths(a.points, trail, radius))
      if (!hits.length) return
      hits.forEach((a) => touch(a.id))
      history.commit((list) =>
        list.flatMap((a) => {
          if (!hits.some((h) => h.id === a.id)) return [a]
          const paths = eraseFromPaths(a.points!, trail, radius)!
          return paths.length ? [withBounds({ ...a, points: paths })] : []
        })
      )
    },
    [history.commit, touch]
  )

  const createShape = useCallback(
    (shape: Omit<Annot, 'id'>) => {
      const a: Annot = {
        author: authorRef.current || undefined,
        created: new Date().toISOString(),
        ...shape,
        id: nextAnnotId.current++,
        ...(canFill(shape.kind) && fillsRef.current[shape.kind] ? { fill: fillsRef.current[shape.kind] } : {}),
        ...(canDash(shape.kind) && dashesRef.current[shape.kind] ? { dash: dashesRef.current[shape.kind] } : {}),
        ...extraStyle(shape.kind)
      }
      history.commit((list) => [...list, a])
      setSelectedAnnot(a.id)
      // A new callout goes straight to typing its text.
      if (a.kind === 'callout') {
        setEditingAnnot(a.id)
        setTool('select')
      }
    },
    [history.commit]
  )

  const reshapeAnnot = useCallback(
    (id: number, index: number, dx: number, dy: number) => {
      touch(id)
      history.commit((list) =>
        list.map((a) => {
          if (a.id !== id || !a.points) return a
          const size = pages[a.page]
          const first = a.points[0].map((p, i) =>
            i === index ? { x: Math.max(0, Math.min(size.width, p.x + dx)), y: Math.max(0, Math.min(size.height, p.y + dy)) } : p
          )
          return withBounds({ ...a, points: [first, ...a.points.slice(1)] })
        })
      )
    },
    [pages, history.commit, touch]
  )

  const moveAnnot = useCallback(
    (id: number, dx: number, dy: number) => {
      // Dragging one of several selected annotations moves them all.
      const ids = selIdsRef.current.has(id) && selIdsRef.current.size > 1 ? selIdsRef.current : new Set([id])
      ids.forEach(touch)
      history.commit((list) =>
        list.map((a) => {
          if (!ids.has(a.id)) return a
          const size = pages[a.page]
          const r = a.rects[0]
          const x = Math.max(0, Math.min(size.width - r.w, r.x + dx))
          const y = Math.max(0, Math.min(size.height - r.h, r.y + dy))
          return translated(a, x - r.x, y - r.y)
        })
      )
    },
    [pages, history.commit, touch]
  )

  const resizeAnnot = useCallback(
    (id: number, w: number, h: number) => {
      touch(id)
      history.commit((list) =>
        list.map((a) => {
          if (a.id !== id) return a
          const size = pages[a.page]
          const r = a.rects[0]
          return {
            ...a,
            // Foreign annotations can be small (icons); everything else keeps a usable minimum size.
            rects: [{ ...r, w: Math.max(a.kind === 'foreign' ? 4 : 40, Math.min(size.width - r.x, w)), h: Math.max(a.kind === 'foreign' ? 4 : 20, Math.min(size.height - r.y, h)) }]
          }
        })
      )
    },
    [pages, history.commit, touch]
  )

  const removeAnnot = useCallback(
    (id: number) => {
      touch(id)
      history.commit((list) => list.filter((a) => a.id !== id))
      setSelectedAnnot((s) => (s === id ? null : s))
      setEditingAnnot((e) => (e === id ? null : e))
    },
    [history.commit, touch]
  )

  const removeMany = useCallback(
    (ids: ReadonlySet<number>) => {
      ids.forEach(touch)
      history.commit((list) => list.filter((a) => !ids.has(a.id)))
      setSelectedAnnot(null)
      setExtraSel(new Set())
      setEditingAnnot(null)
    },
    [history.commit, touch]
  )

  /** Align, distribute or restack the selected annotations. */
  const arrangeSelected = (fn: (list: Annot[], ids: ReadonlySet<number>) => Annot[], order = false) => {
    const ids = selectedIds
    if (!order) ids.forEach(touch)
    history.commit((list) => fn(list, ids))
    if (order) setZDirty(true)
  }

  /** Areas marked for redaction (display space); nothing is removed until they are applied. */
  const [redactMarks, setRedactMarks] = useState<(RedactMark & { id: number })[]>([])
  const nextMark = useRef(1)
  const [redactConfirm, setRedactConfirm] = useState(false)
  const [hidden, setHidden] = useState<HiddenInfo | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [sigPanel, setSigPanel] = useState(false)
  const [sigRows, setSigRows] = useState<SignatureRow[]>([])
  const [pendingSign, setPendingSign] = useState<SignRequest | null>(null)
  /** Asking whether to go on with a change that would invalidate valid signatures. */
  const [breakPrompt, setBreakPrompt] = useState<((ok: boolean) => void) | null>(null)
  const validSigs = sigRows.filter((r) => r.check.intact && r.check.signatureValid).length
  const validSigsRef = useRef(0)
  const hadSigs = useRef(false)
  hadSigs.current = sigRows.length > 0
  validSigsRef.current = validSigs
  const askBreak = () => new Promise<boolean>((resolve) => setBreakPrompt(() => resolve))
  const [linkDraft, setLinkDraft] = useState<{ page: number; rect: { x: number; y: number; w: number; h: number }; to: 'uri' | 'page'; uri: string; page1: string; id?: number } | null>(null)
  const editAnnot = useCallback(
    (id: number | null) => {
      const link = id === null ? undefined : annotsRef.current.find((a) => a.id === id && a.kind === 'link')
      if (link) {
        setLinkDraft({
          id: link.id,
          page: link.page,
          rect: link.rects[0],
          to: link.linkUri !== undefined ? 'uri' : 'page',
          uri: link.linkUri ?? 'https://',
          page1: String((link.linkPage ?? 0) + 1)
        })
        return
      }
      if (id !== null) touch(id)
      setEditingAnnot(id)
    },
    [touch]
  )

  const finishText = useCallback(
    (id: number, text: string) => {
      setEditingAnnot(null)
      const existing = annotsRef.current.find((a) => a.id === id)
      if (!existing) return
      // A replace mark left empty becomes a plain strikeout.
      if (existing.replace && !text.trim()) {
        history.commit((list) => list.map((a) => (a.id === id ? { ...a, text: '', replace: false } : a)))
        return
      }
      // A note, text box or insert mark left empty is dropped rather than saved as an invisible object.
      if (!text.trim()) return removeAnnot(id)
      if (text !== existing.text) touch(id)
      if (text !== existing.text)
        history.commit((list) =>
          list.map((a) => {
            if (a.id !== id) return a
            // A typewriter box grows and shrinks with its text.
            if (a.kind === 'typewriter') return { ...a, text, rects: [typewriterRect(a.rects[0].x, a.rects[0].y, text, a.fontSize)] }
            return { ...a, text }
          })
        )
    },
    [history.commit, removeAnnot, touch]
  )

  const selected = annots.find((a) => a.id === selectedAnnot) ?? null
  const toolKind: AnnotKind | null =
    tool === 'select' || tool === 'hand' || tool === 'zoom' || tool === 'snapshot' || tool === 'eraser' || tool === 'link' || tool === 'crop' || tool === 'redact' || tool === 'signbox' || tool === 'edittext' || tool === 'editimage' || tool === 'editpath' || tool === 'addimage' || tool === 'formfield' || tool === 'formedit' || tool.startsWith('measure') || tool === 'calibrate'
      ? null
      : (tool as AnnotKind) // every other tool is named after the kind it creates
  const swatchKind: AnnotKind = selected?.kind ?? toolKind ?? lastMarkup
  const showWidth = isShapeKind(swatchKind) || swatchKind === 'stamp'
  const activeWidth = selected && (isShapeKind(selected.kind) || selected.kind === 'stamp') ? selected.lineWidth : (styleMap[swatchKind]?.lineWidth ?? drawWidth)
  const activeColor = selected ? selected.color : colors[swatchKind]

  const pickColor = (c: string) => {
    setColors((m) => ({ ...m, [swatchKind]: c }))
    if (selected) touch(selected.id)
    if (selected) history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, color: c } : a)))
  }

  const pickWidth = (w: number) => {
    setDrawWidth(w)
    setStyleMap((m) => ({ ...m, [swatchKind]: { ...m[swatchKind], lineWidth: w } }))
    if (selected && (isShapeKind(selected.kind) || selected.kind === 'stamp')) {
      touch(selected.id)
      history.commit((list) => list.map((a) => (a.id === selected.id ? withBounds({ ...a, lineWidth: w }) : a)))
    }
  }


  const activeFill = selected ? selected.fill : fills[swatchKind]
  const activeDash = selected ? selected.dash : dashes[swatchKind]
  const pickFill = (c: string | undefined) => {
    setFills((f) => ({ ...f, [swatchKind]: c }))
    if (selected && canFill(selected.kind)) {
      touch(selected.id)
      history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, fill: c } : a)))
    }
  }
  const pickDash = (d: 'dashed' | 'dotted' | undefined) => {
    setDashes((x) => ({ ...x, [swatchKind]: d }))
    if (selected && canDash(selected.kind)) {
      touch(selected.id)
      history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, dash: d } : a)))
    }
  }

  // ---- Properties panel and tool presets ------------------------------------------------------------
  const [propsOpen, setPropsOpen] = useState(false)
  const panelStyle: ToolStyle & { color: string } = selected
    ? {
        color: selected.color,
        fill: selected.fill,
        dash: selected.dash,
        lineWidth: selected.lineWidth,
        opacity: selected.opacity,
        fontFamily: selected.fontFamily,
        fontSize: selected.fontSize
      }
    : { ...(styleMap[swatchKind] ?? {}), color: colors[swatchKind], fill: fills[swatchKind], dash: dashes[swatchKind], lineWidth: styleMap[swatchKind]?.lineWidth ?? drawWidth }
  /** Applies a style change to the selected annotation, or to the current tool. */
  const applyStyle = (patch: ToolStyle) => {
    if (selected) {
      touch(selected.id)
      history.commit((list) =>
        list.map((a) => {
          if (a.id !== selected.id) return a
          const next: Annot = { ...a, ...patch, ...(patch.opacity === 1 ? { opacity: undefined } : {}) }
          if ('fill' in patch && !canFill(a.kind)) delete next.fill
          if (a.kind === 'typewriter' && (patch.fontSize || patch.fontFamily)) next.rects = [typewriterRect(a.rects[0].x, a.rects[0].y, a.text, next.fontSize)]
          return patch.lineWidth !== undefined ? withBounds(next) : next
        })
      )
      return
    }
    if (patch.color) setColors((m) => ({ ...m, [swatchKind]: patch.color! }))
    if ('fill' in patch) setFills((m) => ({ ...m, [swatchKind]: patch.fill }))
    if ('dash' in patch) setDashes((m) => ({ ...m, [swatchKind]: patch.dash }))
    const rest: ToolStyle = { ...patch }
    delete rest.color
    delete rest.fill
    delete rest.dash
    if (Object.keys(rest).length) setStyleMap((m) => ({ ...m, [swatchKind]: { ...m[swatchKind], ...rest } }))
  }
  const setAuthorOf = (author: string) => {
    if (!selected) return
    touch(selected.id)
    history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, author: author || undefined } : a)))
  }
  const makeDefault = () => {
    const { color, fill, dash, lineWidth, opacity, fontFamily, fontSize } = panelStyle
    const style: ToolStyle = { color, ...(fill ? { fill } : {}), ...(dash ? { dash } : {}), lineWidth, ...(opacity !== undefined ? { opacity } : {}), ...(fontFamily ? { fontFamily } : {}), ...(fontSize ? { fontSize } : {}) }
    onSettings({ toolDefaults: { ...toolDefaults, [swatchKind]: style } })
    setNotice({ kind: 'info', text: `New ${annotLabel(swatchKind).toLowerCase()} annotations will use this style` })
  }
  const savePreset = (presetName: string) => {
    const { color, fill, dash, lineWidth, opacity, fontFamily, fontSize } = panelStyle
    const style: ToolStyle = { color, ...(fill ? { fill } : {}), ...(dash ? { dash } : {}), lineWidth, ...(opacity !== undefined ? { opacity } : {}), ...(fontFamily ? { fontFamily } : {}), ...(fontSize ? { fontSize } : {}) }
    onSettings({ toolPresets: [...toolPresets, { id: crypto.randomUUID(), name: presetName, kind: swatchKind, style }] })
  }
  /** A preset arms its tool with its style. */
  const applyPreset = (p: ToolPreset) => {
    const k = p.kind as AnnotKind
    if (p.style.color) setColors((m) => ({ ...m, [k]: p.style.color! }))
    setFills((m) => ({ ...m, [k]: p.style.fill }))
    setDashes((m) => ({ ...m, [k]: p.style.dash }))
    setStyleMap((m) => ({ ...m, [k]: { ...m[k], lineWidth: p.style.lineWidth, opacity: p.style.opacity, fontFamily: p.style.fontFamily, fontSize: p.style.fontSize } }))
    setSelectedAnnot(null)
    if (!isMarkup(k)) setTool(k as Tool)
    else setLastMarkup(k)
  }

  /** Choosing a stamp arms the stamp tool; a text label also relabels the selected text stamp. */
  const pickStamp = (c: StampChoice) => {
    setStampChoice(c)
    setStampPickerOpen(false)
    if (c.kind === 'text' && selected?.kind === 'stamp' && !selected.image) {
      touch(selected.id)
      history.commit((list) =>
        list.map((a) => (a.id === selected.id ? { ...a, text: c.label, rects: [{ ...a.rects[0], w: stampSize(c.label, a.stampInfo).w }] } : a))
      )
    } else setTool('stamp')
  }
  const addStampImages = async () => {
    const res = await window.openpdf.addStamps()
    setStampImages(await window.openpdf.listStamps())
    if (res.refused.length) setNotice({ kind: 'error', text: `Not added (PNG or JPEG up to 8 MB only): ${res.refused.join(', ')}` })
  }
  const removeStampImage = async (id: string) => {
    await window.openpdf.removeStamp(id)
    setStampImages(await window.openpdf.listStamps())
    if (stampChoice.kind === 'image' && stampChoice.stamp.id === id) setStampChoice({ kind: 'text', label: STAMP_LABELS[0] })
  }

  const save = useCallback(
    async (asNew: boolean) => {
      if (saving) return
      if (locked) {
        setNotice({ kind: 'error', text: 'The owner of this document does not allow changes, so nothing was written. Enter the owner password to unlock it.' })
        return
      }
      if (annotsDirty && validSigsRef.current > 0 && !(await askBreak())) return
      setSaving(true)
      try {
        const out = annotsDirty ? await applyEdits(bytes) : bytes
        const toWrite = await protect(out)
        const saved =
          !asNew && path
            ? await window.openpdf.saveFile(path, toWrite)
            : await window.openpdf.saveFileAs(name.replace(/(\.pdf)?$/i, '.pdf'), toWrite)
        if (!saved) return // the Save As dialog was cancelled
        onMeta({ name: saved.name, path: saved.path })
        baseline.current = new Map() // the reloaded document is re-imported with fresh positions
        history.reset([])
        setZDirty(false)
        setProtectionDirty(false)
        setFormValues(new Map())
        setExtraSel(new Set())
        setSelectedAnnot(null)
        setEditingAnnot(null)
        setSavedBytes(out)
        setBytes(out)
        setNotice({ kind: 'info', text: `Saved ${saved.name}` })
      } catch (e) {
        setNotice({ kind: 'error', text: `Could not save: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setSaving(false)
      }
    },
    [saving, locked, protection, annots, deleted, annotsDirty, formValues, zDirty, bytes, path, name, onMeta, history.reset] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ---- Page organisation ----------------------------------------------------------------------------
  const swapBytes = useCallback((next: Uint8Array) => {
    baseline.current = new Map()
    history.reset([])
    setZDirty(false)
    setFormValues(new Map())
    setExtraSel(new Set())
    setSelectedAnnot(null)
    setEditingAnnot(null)
    setBytes(next)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs a structural edit. `fn` gets bytes with pending annotation edits already written in. */
  const applyPageEdit = useCallback(
    async (fn: (base: Uint8Array) => Promise<Uint8Array | null>, done?: string, keepsSignatures = false) => {
      if (busy || saving) return
      if (locked) {
        setNotice({ kind: 'error', text: 'The owner of this document does not allow changes.' })
        return
      }
      if (!keepsSignatures && validSigsRef.current > 0 && !(await askBreak())) return
      setBusy(true)
      try {
        const base = annotsDirty ? await applyEdits(bytes) : bytes
        const out = await fn(base)
        if (!out) return
        setPageUndo((u) => [...u, base])
        setPageRedo([])
        swapBytes(out)
        if (done) setNotice({ kind: 'info', text: done })
      } catch (e) {
        setNotice({ kind: 'error', text: `Page edit failed: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setBusy(false)
      }
    },
    [busy, saving, locked, annotsDirty, formValues, zDirty, bytes, annots, deleted, swapBytes] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const runOptimise = async (o: OptimiseOptions) => {
    setOptimising(false)
    let before = 0
    let summary = ''
    await applyPageEdit(async (b) => {
      before = b.length
      const r = await optimise(b, o)
      const parts = [r.images && `${r.images} picture${r.images === 1 ? '' : 's'} reduced`, r.thumbnails && `${r.thumbnails} thumbnail${r.thumbnails === 1 ? '' : 's'} removed`].filter(Boolean)
      const pct = Math.round((1 - r.bytes.length / before) * 100)
      summary = `Optimised: ${formatSize(before)} to ${formatSize(r.bytes.length)} (${pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`})${parts.length ? `; ${parts.join(', ')}` : ''}`
      return r.bytes
    })
    if (summary) setNotice({ kind: 'info', text: summary })
  }

  /** Click-to-place tools: Add image puts the picked picture on the page as content; the rest make annotations. */
  const placeTool = useCallback(
    async (kind: 'note' | 'textbox' | 'stamp' | 'caret' | 'typewriter' | 'fileattach' | 'sound' | 'addimage', page: number, x: number, y: number) => {
      if (kind !== 'addimage') return place(kind, page, x, y)
      const img = pendingImage.current
      pendingImage.current = null
      setTool('select')
      if (img) await applyPageEdit((b) => addImage(b, page, { x, y }, img), 'Image added')
    },
    [place, applyPageEdit]
  )

  // ---- Form design ----------------------------------------------------------------------------------
  const proposeName = (type: FieldType) => {
    const base: Record<FieldType, string> = { text: 'Text', checkbox: 'Check', radio: 'Group', dropdown: 'Dropdown', list: 'List', button: 'Button', signature: 'Signature' }
    const taken = new Set(formFields.map((f) => f.name))
    let n = 1
    while (taken.has(`${base[type]}${n}`)) n++
    return `${base[type]}${n}`
  }
  /** Choose a kind of field and the drawing tool (pressing it again stops drawing). */
  const startField = (type: FieldType) => {
    if (tool === 'formfield' && fieldKind === type) return setTool('select')
    setFieldKind(type)
    setTool('formfield')
    setNotice({ kind: 'info', text: 'Drag a box on the page where the field should go.' })
  }
  const createField = async (spec: Omit<FieldSpec, 'page' | 'rect' | 'type'>) => {
    const d = fieldDraft
    if (!d) return
    setFieldDraft(null)
    await applyPageEdit((b) => addField(b, { ...spec, type: d.type, page: d.page, rect: d.rect }), 'Field added')
    setTool('formedit')
    setDesignSel({ name: spec.name, widget: 0 })
  }
  /** Look for places where fields belong (blanks, rules, boxes, squares) and ask which to create. */
  const detectFormFields = async () => {
    if (!client) return
    setNotice({ kind: 'info', text: 'Looking for fields…' })
    try {
      const existing = formFields.flatMap((f) => f.widgets.filter((w) => w.page >= 0).map((w) => ({ name: f.name, page: w.page, rect: w.rect })))
      setDetected(await detectInDocument(bytes, (p) => client.pageText(p), existing))
      setNotice(null)
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not look for fields: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const createDetected = async (chosen: Detected[]) => {
    setDetected(null)
    const specs: FieldSpec[] = chosen.map((d) => ({ type: d.type, name: d.name, page: d.page, rect: d.rect, border: null, background: null, tooltip: d.label || undefined }))
    await applyPageEdit((b) => addFields(b, specs), `${specs.length} field${specs.length === 1 ? '' : 's'} added`)
  }
  const changeField = async (name: string, patch: FieldPatch) => {
    setFieldEdit(null)
    await applyPageEdit((b) => updateField(b, name, patch), 'Field updated')
    if (patch.name && designSel?.name === name) setDesignSel({ name: patch.name, widget: designSel.widget })
  }
  const removeField = async (name: string) => {
    setDesignSel(null)
    await applyPageEdit((b) => deleteField(b, name), 'Field deleted')
  }
  const moveField = (name: string, widget: number, rect: { x: number; y: number; w: number; h: number }) => void applyPageEdit((b) => placeWidget(b, name, widget, rect), 'Field moved')
  const chooseTabOrder = (order: TabOrder) => void applyPageEdit((b) => setTabOrder(b, order), 'Tab order changed')
  const stepTabOrder = (dir: -1 | 1) => designSel && void applyPageEdit((b) => moveInTabOrder(b, designSel.name, dir), 'Tab order changed')
  /** A push button was pressed in the filled-in form. */
  const pressFormButton = (f: FormField) => {
    const a = f.action
    if (!a || a.kind === 'none') return
    if (a.kind === 'reset') resetForm()
    else if (a.kind === 'uri' && a.url) void window.openpdf.openLink(a.url)
    else if (a.kind === 'javascript') {
      void runScript('MouseUp', a.code, f.name, fieldStates(formFields, formValues), {}, name).then(async (r) => {
        const merged = new Map(formValuesRef.current)
        for (const [n, v] of r.changed) {
          committedRef.current.set(n, v)
          setFormValue(n, v)
          merged.set(n, v)
        }
        if (r.error) setNotice({ kind: 'error', text: `The script for "${f.name}" failed: ${r.error}` })
        else if (r.alerts.length) setNotice({ kind: 'info', text: r.alerts.join(' ') })
        await applyCalculations(merged)
      })
    } else setNotice({ kind: 'info', text: 'Sending a form to a web address is not supported yet. Use Export to save the data.' })
  }

  // Bookmark edits come quicker than the document reloads: keep the latest tree and write it when free.
  const outlineWant = useRef<BookmarkNode[] | null>(null)
  const [outlineTick, setOutlineTick] = useState(0)
  const editOutline = useCallback((tree: BookmarkNode[]) => {
    outlineWant.current = tree
    setOutlineTick((t) => t + 1)
  }, [])
  useEffect(() => {
    const t = outlineWant.current
    if (!t || busy || saving) return
    outlineWant.current = null
    void applyPageEdit((b) => writeOutline(b, t), 'Bookmarks updated')
  }, [outlineTick, busy, saving, applyPageEdit])

  const undoPageEdit = useCallback(() => {
    const prev = pageUndo[pageUndo.length - 1]
    if (!prev || busy) return
    setPageUndo((u) => u.slice(0, -1))
    setPageRedo((r) => [...r, bytes])
    swapBytes(prev)
  }, [pageUndo, busy, bytes, swapBytes])

  const redoPageEdit = useCallback(() => {
    const next = pageRedo[pageRedo.length - 1]
    if (!next || busy) return
    setPageRedo((r) => r.slice(0, -1))
    setPageUndo((u) => [...u, bytes])
    swapBytes(next)
  }, [pageRedo, busy, bytes, swapBytes])

  const baseName = name.replace(/\.pdf$/i, '')

  const runPageOp = useCallback(
    async (op: PageOp, selection: number[]) => {
      const n = pages.length
      const count = `${selection.length} page${selection.length === 1 ? '' : 's'}`
      switch (op.kind) {
        case 'rotate':
          return applyPageEdit((b) => rotatePages(b, selection, op.delta))
        case 'delete':
          if (selection.length >= n) return setNotice({ kind: 'error', text: 'A document must keep at least one page.' })
          return applyPageEdit((b) => deletePages(b, selection), `Deleted ${count}`)
        case 'move':
          return applyPageEdit((b) => movePages(b, selection, op.before))
        case 'insert': {
          const files = await window.openpdf.openFileDialog()
          if (!files.length) return
          let at = op.at
          let total = 0
          return applyPageEdit(async (b) => {
            let cur = b
            for (const f of files) {
              const r = await insertPagesFrom(cur, f.data, at)
              cur = r.bytes
              at += r.count
              total += r.count
            }
            return cur
          }).then(() => total && setNotice({ kind: 'info', text: `Inserted ${total} page${total === 1 ? '' : 's'}` }))
        }
        case 'extract':
          setDialogText(compactRanges(selection))
          setPageDialog({ kind: 'extract', pages: selection })
          return
        case 'split':
          setDialogText('1')
          setPageDialog({ kind: 'split', pages: selection, mode: 'count' })
          return
        case 'copy': {
          const src = annotsDirty ? await applyEdits(bytes) : bytes
          setPageClip({ bytes: await extractPages(src, selection), count: selection.length, from: name })
          return setNotice({ kind: 'info', text: `Copied ${count}. Paste them into any open document with Ctrl+V in its page thumbnails.` })
        }
        case 'paste': {
          const clip = getPageClip()
          if (!clip) return
          return applyPageEdit(async (b) => (await insertPagesFrom(b, clip.bytes, Math.min(op.at, n))).bytes, `Pasted ${clip.count} page${clip.count === 1 ? '' : 's'}`)
        }
        case 'duplicate':
          return applyPageEdit((b) => duplicatePages(b, selection), `Duplicated ${count}`)
        case 'replace': {
          const file = await window.openpdf.pickFile({ name: 'PDF documents', ext: ['pdf'] })
          if (!file) return
          let otherCount: number
          try {
            otherCount = (await PDFDocument.load(file.data, { updateMetadata: false, ignoreEncryption: true })).getPageCount()
          } catch {
            return setNotice({ kind: 'error', text: `${file.name} could not be read as a PDF.` })
          }
          setDialogText(compactRanges(selection))
          setPageDialog({ kind: 'replace', pages: selection, other: file, otherCount, theirs: `1-${Math.min(otherCount, selection.length)}` })
          return
        }
      }
    },
    [pages.length, applyPageEdit, annotsDirty, formValues, zDirty, bytes, name] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const submitPageDialog = async () => {
    const d = pageDialog
    if (!d) return
    try {
      const src = annotsDirty ? await applyEdits(bytes) : bytes
      if (d.kind === 'extract') {
        const idx = parsePageRanges(dialogText, pages.length)
        const out = await extractPages(src, idx)
        const saved = await window.openpdf.saveFileAs(`${baseName} (extract).pdf`, out)
        if (saved) setNotice({ kind: 'info', text: `Extracted ${idx.length} page${idx.length === 1 ? '' : 's'} to ${saved.name}` })
      } else if (d.kind === 'replace') {
        const mine = parsePageRanges(dialogText, pages.length)
        const theirs = parsePageRanges(d.theirs, d.otherCount)
        setPageDialog(null)
        await applyPageEdit((b) => replacePages(b, mine, d.other.data, theirs), `Replaced ${mine.length} page${mine.length === 1 ? '' : 's'} with ${theirs.length} from ${d.other.name}`)
        return
      } else {
        let parts: Part[]
        if (d.mode === 'count') {
          const size = parseInt(dialogText, 10)
          if (!Number.isFinite(size) || size < 1) throw new Error('Enter a whole number of pages per file, 1 or more.')
          parts = await splitEvery(src, size)
        } else if (d.mode === 'size') {
          const mb = parseFloat(dialogText.replace(',', '.'))
          if (!(mb > 0)) throw new Error('Enter the largest file size in MB, for example 5.')
          parts = await splitBySize(src, mb * 1024 * 1024)
        } else {
          if (!outline?.length) throw new Error('This document has no bookmarks to split by.')
          parts = await splitByRanges(src, bookmarkRanges(outline, pages.length))
        }
        // Characters Windows does not allow in file names, including control characters.
        // eslint-disable-next-line no-control-regex
        const safe = (t: string) => t.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80)
        const res = await window.openpdf.saveMany(
          parts.map((p) => ({ name: p.title ? `${baseName} - ${safe(p.title)}.pdf` : `${baseName} (pages ${p.first}-${p.last}).pdf`, data: p.bytes }))
        )
        if (res) setNotice({ kind: 'info', text: `Wrote ${res.written.length} files to ${res.dir}` })
      }
      setPageDialog(null)
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Merge: append whole files to the end of this document. */
  const mergeFiles = () => void runPageOp({ kind: 'insert', at: pages.length }, [])

  // ---- Reading: read aloud, reading mode, page colours ----------------------------------------------
  const [readingMode, setReadingMode] = useState(false)
  const [pageColours, setPageColours] = useState<'normal' | 'night' | 'contrast'>('normal')
  const [readerState, setReaderState] = useState<ReaderState>('idle')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceURI, setVoiceURI] = useState<string | undefined>()
  const [speechRate, setSpeechRate] = useState(1)
  const speechOpts = useRef({ voiceURI, rate: speechRate })
  speechOpts.current = { voiceURI, rate: speechRate }
  const reader = useRef<Reader | null>(null)
  useEffect(() => {
    const load = () => setVoices(speechSynthesis.getVoices())
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load)
      reader.current?.stop()
    }
  }, [])
  // Leaving the tab stops reading.
  useEffect(() => {
    if (!active) reader.current?.stop()
  }, [active])
  const readAloud = async () => {
    const c = clientRef.current
    if (!c) return
    const count = pages.length
    reader.current?.stop()
    const r = new Reader({
      ...speechOpts.current,
      pageText: async (p) => (p < count ? (await c.pageText(p)).text : null),
      onPage: (p) => viewer.current?.scrollToPage(p),
      onState: setReaderState
    })
    reader.current = r
    // With text selected, read just the selection; otherwise from the current page to the end.
    const selected = viewer.current?.hasSelection() ? await viewer.current.selectedText() : null
    void r.start(currentPage, selected ?? undefined)
  }

  // ---- Rulers, grid, guides -------------------------------------------------------------------------
  const [aids, setAids] = useState<ViewAids>({ rulers: false, unit: 'mm', grid: null, snap: false })
  const [guides, setGuides] = useState<Guide[]>([])
  const GRID_MM = [5, 10, 20, 50]

  const commentAnnots = useMemo(() => annots.filter((a) => a.kind !== 'link'), [annots])

  // ---- Page marks and boxes (Layout tab) -------------------------------------------------------------
  const [marksMode, setMarksMode] = useState<MarksMode | null>(null)
  const [presentMarks, setPresentMarks] = useState<Set<MarkKind>>(new Set())
  useEffect(() => {
    let cancelled = false
    marksPresent(bytes).then((m) => !cancelled && setPresentMarks(m))
    return () => {
      cancelled = true
    }
  }, [bytes])
  const applyMarks = async (r: MarksRequest) => {
    setMarksMode(null)
    const info = { fileName: name, labels: pageLabels }
    const count = (p: number[]) => `${p.length} page${p.length === 1 ? '' : 's'}`
    if (r.mode === 'headerfooter' || r.mode === 'pagenumbers' || r.mode === 'bates')
      return applyPageEdit((b) => addHeaderFooter(b, r.spec, info), `Added ${r.mode === 'bates' ? 'Bates numbers' : r.mode === 'pagenumbers' ? 'page numbers' : 'a header and footer'} to ${count(r.spec.pages)}`)
    if (r.mode === 'watermark') return applyPageEdit((b) => addWatermark(b, r.spec), `Added a watermark to ${count(r.spec.pages)}`)
    if (r.mode === 'background') return applyPageEdit((b) => addBackground(b, r.spec), `Added a background to ${count(r.spec.pages)}`)
    if (r.mode === 'crop') return applyPageEdit((b) => cropPages(b, r.pages, r.margins), `Cropped ${count(r.pages)}`)
    if (r.mode === 'uncrop') return applyPageEdit((b) => uncropPages(b, r.pages), `Removed cropping from ${count(r.pages)}`)
    if (r.mode === 'resize') return applyPageEdit((b) => resizePages(b, r.pages, r.width, r.height, r.fit), `Resized ${count(r.pages)}`)
    if (r.mode !== 'remove') return
    const kinds = r.kinds
    let removed = 0
    await applyPageEdit(async (b) => {
      const out = await removeMarks(b, kinds)
      removed = out.removed
      return out.bytes
    })
    setNotice({ kind: 'info', text: removed ? `Removed ${removed} mark${removed === 1 ? '' : 's'}` : 'There were no such marks to remove' })
  }
  const cropToRect = (page: number, rect: { x: number; y: number; w: number; h: number }) => {
    setTool('select')
    void applyPageEdit((b) => cropPages(b, opPagesRef.current.includes(page) ? opPagesRef.current : [page], { rect }), 'Cropped')
  }
  const opPagesRef = useRef<number[]>([])

  // ---- Converting ------------------------------------------------------------------------------------
  const [createFrom, setCreateFrom] = useState<{ kind: 'images' | 'text'; files: { name: string; data: Uint8Array }[] } | null>(null)
  const [officeReady, setOfficeReady] = useState(true)
  const [exportImagesOpen, setExportImagesOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [ocrOpen, setOcrOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  useEffect(() => {
    void window.openpdf.officeAvailable().then(setOfficeReady, () => setOfficeReady(false))
  }, [])
  const stem = (n: string) => n.replace(/\.[^.]*$/, '')
  const today = () => new Date().toLocaleDateString('en-AU').replace(/\//g, '-')
  /** Runs a conversion and opens its result as a new, unsaved document. */
  const makeNew = async (label: string, fn: () => Promise<{ name: string; data: Uint8Array } | null>) => {
    setBusy(true)
    try {
      const made = await fn()
      if (made) onNewDoc(made.name, made.data)
    } catch (e) {
      setNotice({ kind: 'error', text: `${label}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }
  const pickToCreate = async (kind: 'images' | 'text') => {
    const files =
      kind === 'images'
        ? await window.openpdf.pickFiles({ name: 'Pictures', ext: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'] })
        : await window.openpdf.pickFiles({ name: 'Text files', ext: ['txt', 'md', 'csv', 'log'] })
    if (files.length) setCreateFrom({ kind, files: kind === 'text' ? files.slice(0, 1) : files })
  }
  const runCreate = (r: CreateRequest) => {
    const from = createFrom
    setCreateFrom(null)
    if (!from) return
    void makeNew('Could not create the PDF', async () => {
      if (r.kind === 'images') return { name: `${stem(from.files[0].name)}.pdf`, data: await imagesToPdf(from.files, r.size) }
      const text = new TextDecoder('utf-8').decode(from.files[0].data)
      const wide = [...text].some((ch) => ch.charCodeAt(0) > 0xff)
      const unicode = wide ? await window.openpdf.findFont('Arial', false, false).catch(() => null) : null
      return { name: `${stem(from.files[0].name)}.pdf`, data: await textToPdf(text, { font: r.font, size: r.fontSize, unicode: unicode?.data }) }
    })
  }
  const fromPicture = (label: string, get: () => Promise<Uint8Array | null>, name: string, empty: string) =>
    makeNew(label, async () => {
      const png = await get()
      if (!png) {
        setNotice({ kind: 'info', text: empty })
        return null
      }
      return { name, data: await imagesToPdf([{ name, data: png }], 'image') }
    })

  const runOcr = async (r: OcrRequest) => {
    setOcrOpen(false)
    if (!client) return
    let result: Awaited<ReturnType<typeof ocrDocument>> | null = null
    try {
      await applyPageEdit(async (b) => {
        const out = await ocrDocument(
          b,
          { languages: r.languages, dpi: r.dpi, scope: r.scope === 'all' ? 'all' : 'blank', pages: r.scope === 'current' ? [currentPage] : undefined },
          {
            client,
            pages,
            recognise: (png, langs) => window.openpdf.ocrRecognise(png, langs),
            findFont: async (family) => (await window.openpdf.findFont(family, false, false).catch(() => null))?.data ?? null,
            toPng: (w, h, rgba) => encodeRotatedPng(w, h, rgba, 0),
            progress: (page, done, total) => setNotice({ kind: 'info', text: `Recognising page ${page + 1} (${done} of ${total})…` })
          }
        )
        result = out
        return out.nothingToDo ? null : out.bytes
      })
    } catch (e) {
      setNotice({ kind: 'error', text: `Text recognition failed: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
    const out = result as Awaited<ReturnType<typeof ocrDocument>> | null
    if (!out) return
    if (out.nothingToDo) return setNotice({ kind: 'info', text: 'Every page already has text. Choose "All pages" to recognise them anyway.' })
    setNotice({ kind: 'info', text: `Recognised ${out.words} word${out.words === 1 ? '' : 's'} on ${out.pagesDone} page${out.pagesDone === 1 ? '' : 's'} (average confidence ${Math.round(out.confidence)}%).${out.skipped ? ` ${out.skipped} word${out.skipped === 1 ? '' : 's'} could not be written with the available font.` : ''}` })
  }
  const runScan = (r: ScanRequest) => {
    setScanOpen(false)
    void makeNew('Could not scan', async () => {
      setNotice({ kind: 'info', text: 'Scanning…' })
      const sheets = await window.openpdf.scan(r)
      if (!sheets.length) {
        setNotice({ kind: 'info', text: 'Nothing was scanned.' })
        return null
      }
      // Direct scans know their resolution; the scanner's own window does not say, so 200 dpi is assumed for the page size.
      const dpi = r.source === 'dialog' ? 200 : r.dpi
      let bytes = await imagesToPdf(sheets.map((data, i) => ({ name: `scan${i + 1}.png`, data })), 'image', dpi)
      if (r.ocr) {
        const inputs: OcrInput[] = []
        for (let i = 0; i < sheets.length; i++) {
          setNotice({ kind: 'info', text: `Recognising text on sheet ${i + 1} of ${sheets.length}…` })
          inputs.push({ page: i, scale: dpi / 72, lines: (await window.openpdf.ocrRecognise(sheets[i], ['eng'])).lines })
        }
        bytes = (await addTextLayer(bytes, inputs)).bytes
      }
      setNotice({ kind: 'info', text: `Scanned ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}.` })
      return { name: `Scan ${today()}.pdf`, data: bytes }
    })
  }
  const exportStem = () => stem(name) || 'document'
  const runExportImages = async (r: ExportImagesRequest) => {
    setExportImagesOpen(false)
    if (!client) return
    setBusy(true)
    try {
      const list = r.scope === 'current' ? [currentPage] : pages.map((_, i) => i)
      const files: { name: string; data: Uint8Array }[] = []
      for (const p of list) {
        setNotice({ kind: 'info', text: `Rendering page ${p + 1} of ${pages.length}…` })
        const out = await client.render(p, scaleFor(r.dpi, pages[p].width, pages[p].height))
        files.push({ name: pageFileName(exportStem(), p, pages.length, r.format), data: await encodePage(out.data, out.width, out.height, r.format) })
      }
      const saved = await window.openpdf.saveFiles(files)
      setNotice(saved ? { kind: 'info', text: `Saved ${files.length} picture${files.length === 1 ? '' : 's'} in ${saved.dir}` } : null)
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not export the pictures: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }
  /** Every page's text as blocks in reading order (from the page's text objects, or its plain text where it has none). */
  const exportStructure = async (): Promise<ExportBlock[][]> => {
    if (!client) return []
    const raw: Awaited<ReturnType<typeof groupBlocks>>[] = []
    for (let p = 0; p < pages.length; p++) {
      const t = await client.textObjects(p)
      raw.push(groupBlocks(t.objects, t.rotation))
    }
    const body = bodySize(raw)
    const out: ExportBlock[][] = []
    for (let p = 0; p < pages.length; p++) {
      const blocks = structurePage(raw[p], body)
      if (blocks.length) out.push(blocks)
      else {
        const plain = normaliseNewlines((await client.pageText(p)).text)
        out.push(plain.split(/\n+/).filter((l) => l.trim()).map((l) => ({ text: l.trim(), heading: 0 as const, size: body, bold: false, italic: false })))
      }
    }
    return out
  }
  const exportAs = async (kind: 'txt' | 'html' | 'docx') => {
    if (!client) return
    setBusy(true)
    try {
      let data: Uint8Array
      if (kind === 'txt') {
        const all: string[] = []
        for (let p = 0; p < pages.length; p++) all.push(normaliseNewlines((await client.pageText(p)).text))
        data = new TextEncoder().encode(all.join('\n\f\n'))
      } else {
        const structure = await exportStructure()
        data = kind === 'html' ? new TextEncoder().encode(toHtml(exportStem(), structure)) : await toDocx(exportStem(), structure)
      }
      const label = { txt: 'Text', html: 'HTML', docx: 'Word' }[kind]
      const saved = await window.openpdf.saveData(`${exportStem()}.${kind}`, data, { name: `${label} files`, ext: kind })
      if (saved) setNotice({ kind: 'info', text: `Exported ${saved}` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not export: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  // ---- Signatures ------------------------------------------------------------------------------------
  useEffect(() => {
    let live = true
    const needle = new TextEncoder().encode('/ByteRange')
    const mayBeSigned = (() => {
      outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
        if (bytes[i] !== 0x2f) continue
        for (let k = 1; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer
        return true
      }
      return false
    })()
    // A file rewritten after signing keeps its signature dictionary but compresses it, so a document that was signed stays listed.
    if (!mayBeSigned && !hadSigs.current) {
      setSigRows([])
      return
    }
    void (async () => {
      const infos = await readSignatures(bytes)
      const end = (i: { byteRange: number[] }) => i.byteRange[2] + i.byteRange[3]
      const rows: SignatureRow[] = []
      for (const info of infos) rows.push({ info, check: await verifySignature(bytes, info), later: infos.some((o) => o !== info && end(o) > end(info)) })
      if (!live) return
      setSigRows(rows)
      // Whether Windows trusts each signer takes a moment longer, so it follows.
      const withChain = await Promise.all(rows.map(async (r) => ({ ...r, chain: await window.openpdf.chainStatus(r.check.certificates).catch(() => undefined) })))
      if (live) setSigRows(withChain)
    })().catch(() => live && setSigRows([]))
    return () => {
      live = false
    }
  }, [bytes])
  useEffect(() => {
    if (tool !== 'signbox') setPendingSign(null)
  }, [tool])

  const startSign = (r: SignRequest) => {
    setSignOpen(false)
    if (protection.kind !== 'none') return setNotice({ kind: 'error', text: 'This document is protected with a password. Remove the security (File > Security), then sign it.' })
    if (r.visible) {
      setPendingSign(r)
      setTool('signbox')
      setNotice({ kind: 'info', text: 'Drag a box on the page where the signature should appear.' })
    } else void doSign(r)
  }
  const doSign = async (r: SignRequest, visible?: { page: number; rect: { x: number; y: number; w: number; h: number } }) => {
    setTool('select')
    setPendingSign(null)
    await applyPageEdit(
      async (base) => {
        const prepared = await prepareSignature(base, { signerName: r.signerName, reason: r.reason || undefined, location: r.location || undefined, contact: r.contact || undefined, signedAt: new Date(), visible, certify: r.certify })
        let cms = await window.openpdf.signCms(prepared.toSign, r.source)
        if (r.tsaUrl) {
          try {
            cms = addTimestamp(cms, await window.openpdf.timestamp(r.tsaUrl, await buildTimestampRequest(cms)))
          } catch (e) {
            throw new Error(`The time-stamp could not be added, so the document was not signed (${e instanceof Error ? e.message : String(e)}).`, { cause: e })
          }
        }
        return prepared.finish(cms)
      },
      'Signed. Save to write the signed file; changing it afterwards invalidates the signature.',
      true
    )
  }

  // ---- Redaction -------------------------------------------------------------------------------------
  const addMarks = (list: RedactMark[]) => setRedactMarks((m) => [...m, ...list.map((x) => ({ ...x, id: nextMark.current++ }))])
  useEffect(() => setRedactMarks([]), [pages.length])
  const markSelectionForRedaction = async () => {
    const parts = (await viewer.current?.selectionRects()) ?? []
    if (!parts.length) return setNotice({ kind: 'info', text: 'Select some text first, then mark it.' })
    addMarks(parts.flatMap((p) => p.rects.map((rect) => ({ page: p.page, rect }))))
    viewer.current?.clearSelection()
  }
  const markSearchForRedaction = async () => {
    if (!client || !matches.length) return setNotice({ kind: 'info', text: 'Search for the text first (Ctrl+F); every match is then marked.' })
    const list: RedactMark[] = []
    for (const m of matches) list.push(...rangeRects((await client.pageText(m.page)).boxes, m.from, m.to).map((rect) => ({ page: m.page, rect })))
    addMarks(list)
    setNotice({ kind: 'info', text: `Marked ${matches.length} match${matches.length === 1 ? '' : 'es'} for redaction.` })
  }
  const openSanitise = async () => {
    try {
      setHidden(await scanHidden(annotsDirty ? await applyEdits(bytes) : bytes))
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not look for hidden information: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const applyRedactions = async () => {
    setRedactConfirm(false)
    if (!client || !redactMarks.length) return
    const marks = redactMarks.map(({ page, rect }) => ({ page, rect }))
    let report: RedactReport | null = null
    await applyPageEdit(async (b) => {
      const r = await redactPages(b, marks, async (pg) => {
        const [t, i, pa] = await Promise.all([client.textObjects(pg), client.imageObjects(pg), client.pathObjects(pg)])
        return { texts: t.objects, textTotal: t.total, images: i.objects, imageTotal: i.total, paths: pa.objects, pathTotal: pa.total }
      })
      report = r.report
      return r.bytes
    })
    if (!report) return
    const r: RedactReport = report
    setRedactMarks([])
    setTool('select')
    const parts = [r.text && `${r.text} piece${r.text === 1 ? '' : 's'} of text`, r.images && `${r.images} image${r.images === 1 ? '' : 's'}`, r.shapes && `${r.shapes} shape${r.shapes === 1 ? '' : 's'}`, r.annotations && `${r.annotations} annotation${r.annotations === 1 ? '' : 's'}`].filter(Boolean)
    const done = `Redacted: ${parts.length ? parts.join(', ') : 'nothing but the area'} removed.`
    setNotice(
      r.unchecked.length
        ? { kind: 'error', text: `${done} Page${r.unchecked.length === 1 ? '' : 's'} ${compactRanges(r.unchecked)} also draw${r.unchecked.length === 1 ? 's' : ''} content from forms, which could not be checked: look at the result before sharing it.` }
        : { kind: 'info', text: done }
    )
  }

  const [hasPageClip, setHasPageClip] = useState(() => getPageClip() !== null)
  useEffect(() => onPageClip(() => setHasPageClip(getPageClip() !== null)), [])

  // ---- Links ----------------------------------------------------------------------------------------
  const finishLink = () => {
    const d = linkDraft
    if (!d) return
    const target = d.to === 'page' ? Number(d.page1) - 1 : -1
    if (d.to === 'page' && !(target >= 0 && target < pages.length)) {
      setNotice({ kind: 'error', text: `Enter a page from 1 to ${pages.length}.` })
      return
    }
    if (d.to === 'uri' && !/^(https?:\/\/\S+\.\S+|mailto:\S+@\S+)$/i.test(d.uri.trim())) {
      setNotice({ kind: 'error', text: 'Enter a web address starting with https:// (or a mailto: address).' })
      return
    }
    setLinkDraft(null)
    if (d.id !== undefined) {
      const id = d.id
      touch(id)
      history.commit((list) => list.map((x) => (x.id === id ? { ...x, linkPage: d.to === 'page' ? target : undefined, linkUri: d.to === 'uri' ? d.uri.trim() : undefined } : x)))
      return
    }
    const a = newAnnot('link', d.page, [d.rect])
    if (d.to === 'page') a.linkPage = target
    else a.linkUri = d.uri.trim()
    history.commit((list) => [...list, a])
    setTool('select')
  }

  // ---- Comments: threads, status, summary, export ------------------------------------------------------
  const focusComment = useCallback((id: number) => {
    const a = annotsRef.current.find((x) => x.id === id)
    if (!a) return
    setSelectedAnnot(id)
    if (a.rects[0]) void viewer.current?.scrollToRect(a.page, a.rects[0])
  }, [])
  const addReply = useCallback(
    (id: number, text: string, state?: ReviewState) => {
      const reply: Reply = { id: nextAnnotId.current++, author: authorRef.current, text, date: new Date().toISOString(), ...(state ? { state } : {}) }
      history.commit((list) => list.map((a) => (a.id === id ? { ...a, replies: [...(a.replies ?? []), reply] } : a)))
    },
    [history.commit]
  )
  const setReviewState = useCallback((id: number, state: ReviewState) => addReply(id, '', state), [addReply])
  const deleteReply = useCallback(
    (id: number, replyId: number) =>
      history.commit((list) => list.map((a) => (a.id === id ? { ...a, replies: (a.replies ?? []).filter((r) => r.id !== replyId) } : a))),
    [history.commit]
  )
  const summariseComments = async () => {
    try {
      const out = await commentSummaryPdf(annots, pageLabels, name)
      const saved = await window.openpdf.saveFileAs(`${baseName} (comment summary).pdf`, out)
      if (saved) setNotice({ kind: 'info', text: `Comment summary saved as ${saved.name}` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not summarise the comments: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  /** Comments out as XFDF or FDF, in PDF page coordinates. */
  const exportComments = async (format: 'xfdf' | 'fdf') => {
    try {
      const norms = toNorms(commentAnnots, await pageFrames(bytes))
      const data = format === 'xfdf' ? new TextEncoder().encode(toXfdf(norms, name)) : toFdf(norms, name)
      const saved = await window.openpdf.saveData(`${baseName}.${format}`, data, { name: format === 'xfdf' ? 'XFDF comments' : 'FDF comments', ext: format })
      if (saved) setNotice({ kind: 'info', text: `Exported ${commentAnnots.length} comment${commentAnnots.length === 1 ? '' : 's'} to ${saved}` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not export the comments: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  /** Comments in from an XFDF or FDF file: added as new annotations (undo removes them). */
  const importComments = async () => {
    const file = await window.openpdf.pickFile({ name: 'Comment files (XFDF, FDF)', ext: ['xfdf', 'fdf', 'xml'] })
    if (!file) return
    try {
      const head = new TextDecoder('latin1').decode(file.data.subarray(0, 8))
      const norms = head.startsWith('%FDF-') ? await fromFdf(file.data) : fromXfdf(new TextDecoder().decode(file.data))
      const { annots: made, skipped } = fromNorms(norms, await pageFrames(bytes), () => nextAnnotId.current++)
      const usable = made.filter((a) => a.page < pages.length)
      history.commit((list) => [...list, ...usable])
      setNotice({
        kind: 'info',
        text: `Imported ${usable.length} comment${usable.length === 1 ? '' : 's'} from ${file.name}${skipped + made.length - usable.length ? ` (${skipped + made.length - usable.length} could not be used)` : ''}`
      })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not import the comments: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  // ---- Compare comments with another copy ------------------------------------------------------------
  const [comparison, setComparison] = useState<{ otherName: string; result: Comparison } | null>(null)
  const compareWith = async () => {
    const file = await window.openpdf.pickFile({ name: 'PDF documents', ext: ['pdf'] })
    if (!file) return
    const other = new PdfClient()
    try {
      await other.load(file.data)
      let n = 1
      const theirs = (await other.annots())
        .flatMap(({ page, annots: list, replies }) => annotsFromImported(page, list, replies, () => n++))
        .filter((a) => a.kind !== 'foreign' && a.kind !== 'link')
      setComparison({ otherName: file.name, result: compareAnnots(commentAnnots.filter((a) => a.kind !== 'foreign'), theirs) })
      setPropsOpen(false)
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not compare: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      other.dispose()
    }
  }
  /** A comment from the other copy, added here as a new annotation. */
  const adoptTheirs = (list: Annot[]) => {
    const made = list.map((a) => ({
      ...a,
      id: nextAnnotId.current++,
      origin: undefined,
      replies: a.replies?.map((r) => ({ ...r, id: nextAnnotId.current++, origin: undefined }))
    }))
    history.commit((all) => [...all, ...made])
    setComparison((c) => (c ? { ...c, result: { ...c.result, onlyTheirs: c.result.onlyTheirs.filter((x) => !list.includes(x)) } } : c))
  }
  const takeTheirsAt = (i: number) => {
    const c = comparison?.result.changed[i]
    if (!c) return
    touch(c.mine.id)
    history.commit((all) => all.map((a) => (a.id === c.mine.id ? takeTheirs(a, c.theirs, () => nextAnnotId.current++) : a)))
    setComparison((cur) => (cur ? { ...cur, result: { ...cur.result, changed: cur.result.changed.filter((_, k) => k !== i), same: cur.result.same + 1 } } : cur))
  }

  const exportCommentsCsv = async () => {
    const saved = await window.openpdf.saveText(`${baseName} (comments).csv`, commentsCsv(annots, pageLabels), { name: 'CSV (comma separated)', ext: 'csv' })
    if (saved) setNotice({ kind: 'info', text: `Comments exported to ${saved}` })
  }

  // ---- Measurement ----------------------------------------------------------------------------------
  // Measurements are saved as measurement annotations. The scale comes from calibration, the page's own
  // viewport measure dictionaries, or paper millimetres.
  const measurements = useMemo(() => annots.filter((a) => a.measure), [annots])
  const [calibrated, setCalibrated] = useState<Scale | null>(null)
  const [viewports, setViewports] = useState<Viewport[][]>([])
  const [calibrating, setCalibrating] = useState<{ lengthPt: number; real: string; unit: string } | null>(null)
  const viewportsRef = useRef(viewports)
  viewportsRef.current = viewports
  const calibratedRef = useRef(calibrated)
  calibratedRef.current = calibrated
  useEffect(() => {
    let cancelled = false
    readViewports(bytes).then((v) => !cancelled && setViewports(v))
    return () => {
      cancelled = true
    }
  }, [bytes])
  const measureScale = useCallback((page: number, at: Pt) => scaleAt(at, viewports[page], calibrated), [viewports, calibrated])
  const measureLabel = useCallback(
    (kind: MeasureKind, points: Pt[], page: number) => {
      const s = measureScale(page, points[0])
      if (kind === 'area') return formatArea(polygonArea(points), s)
      return formatLength(pathLength(points), s)
    },
    [measureScale]
  )
  const onMeasure = useCallback((kind: MeasureKind | 'calibrate', page: number, points: Pt[]) => {
    if (kind === 'calibrate') {
      setCalibrating({ lengthPt: pathLength(points), real: '', unit: 'm' })
      return
    }
    const s = scaleAt(points[0], viewportsRef.current[page], calibratedRef.current)
    const label = kind === 'area' ? formatArea(polygonArea(points), s) : formatLength(pathLength(points), s)
    const a = newAnnot(kind === 'distance' ? 'line' : kind === 'perimeter' ? 'polyline' : 'polygon', page, [], '')
    const made = withBounds({
      ...a,
      color: MEASURE_COLOR,
      lineWidth: 1,
      points: [points],
      measure: { kind, factor: s.factor, unit: s.unit, ratio: s.label, label }
    })
    history.commit((list) => [...list, made])
  }, [history.commit]) // eslint-disable-line react-hooks/exhaustive-deps
  const scaleText = calibrated
    ? `Calibrated: ${calibrated.label}`
    : viewports[currentPage]?.length
      ? `From the document${viewports[currentPage][0].scale.label ? `: ${viewports[currentPage][0].scale.label}` : ''} (${viewports[currentPage][0].scale.unit})`
      : 'Paper size (mm)'
  const copyMeasurements = async () => {
    const lines = measurements.map((m) => `Page ${m.page + 1}\t${m.measure!.kind}\t${m.measure!.label}`)
    await navigator.clipboard.writeText(lines.join('\n'))
    setNotice({ kind: 'info', text: `Copied ${lines.length} measurement${lines.length === 1 ? '' : 's'}` })
  }

  // ---- Presentation ---------------------------------------------------------------------------------
  // Shows the document as Save would write it (pending annotations included) and with the view's layers.
  const [presenting, setPresenting] = useState<{ bytes: Uint8Array; start: number } | null>(null)
  const present = useCallback(async () => {
    if (!pages.length) return
    let src = bytes
    try {
      if (annotsDirty && !locked) src = await applyEdits(bytes)
      if (hiddenLayers) src = await withHiddenLayers(src, hiddenLayers)
    } catch {
      src = bytes
    }
    setPresenting({ bytes: src, start: currentPage })
  }, [pages.length, bytes, annotsDirty, formValues, zDirty, locked, annots, deleted, hiddenLayers, currentPage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Print ----------------------------------------------------------------------------------------
  const [printDialog, setPrintDialog] = useState<PrintChoice | null>(null)
  const [printing, setPrinting] = useState<{ done: number; total: number; ctrl: AbortController } | null>(null)
  const openPrint = useCallback(() => {
    if (!pages.length || printing) return
    setPrintDialog((d) => d ?? { range: 'all', custom: `1-${pages.length}`, copies: 1, fit: true, autoRotate: true, perSheet: 1 })
  }, [pages.length, printing])

  const runPrint = async (c: PrintChoice) => {
    let list: number[]
    try {
      list =
        c.range === 'all' ? pages.map((_, i) => i) : c.range === 'current' ? [currentPage] : parsePageRanges(c.custom, pages.length)
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
      return
    }
    setPrintDialog(null)
    const ctrl = new AbortController()
    setPrinting({ done: 0, total: list.length, ctrl })
    try {
      // Pending annotation edits are written into a copy first, so the printout matches what Save would write.
      // PDFium then draws everything, including annotations, at print resolution.
      let src = bytes
      if (annotsDirty && !locked) src = await applyEdits(bytes)
      // Print what is on screen: layers hidden in the view are hidden on paper too.
      if (hiddenLayers) src = await withHiddenLayers(src, hiddenLayers)
      const res = await printDocument(
        src,
        undefined,
        {
          pages: list,
          copies: c.copies,
          fit: c.fit,
          autoRotate: c.autoRotate,
          layout: c.perSheet === 'booklet' ? { kind: 'booklet' } : c.perSheet === 1 ? { kind: 'single' } : { kind: 'nup', perSheet: c.perSheet }
        },
        (done, total) => setPrinting((p) => (p ? { ...p, done, total } : p)),
        ctrl.signal
      )
      if (res.error) setNotice({ kind: 'error', text: `Could not print: ${res.error}` })
      else if (res.pdfPath) setNotice({ kind: 'info', text: `Print output written to ${res.pdfPath}` })
      else if (res.ok) setNotice({ kind: 'info', text: `Sent ${list.length} page${list.length === 1 ? '' : 's'} to the printer` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not print: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setPrinting(null)
    }
  }

  // ---- Search ---------------------------------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [matches, setMatches] = useState<Match[]>([])
  const [current, setCurrent] = useState(-1)
  const [searching, setSearching] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const runId = useRef(0)
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const currentRef = useRef(current)
  currentRef.current = current
  // A search-in-files result: fill in the find bar and go to that match once the search reaches it.
  const jumpTarget = useRef<{ page: number; from: number } | null>(null)
  useEffect(() => {
    if (!jump) return
    jumpTarget.current = { page: jump.page, from: jump.from }
    setQuery(jump.query)
    setMatchCase(jump.matchCase)
    setWholeWord(jump.wholeWord)
    setSearchOpen(true)
    // The query may be unchanged, in which case the search does not rerun; go straight there.
    const hit = matchesRef.current.findIndex((m) => m.page === jump.page && m.from === jump.from)
    if (hit >= 0) {
      jumpTarget.current = null
      setCurrent(hit)
      viewer.current?.scrollToMatch(matchesRef.current[hit])
    }
  }, [jump?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!client || !searchOpen || !query) {
      setMatches([])
      setCurrent(-1)
      setSearching(false)
      return
    }
    const run = ++runId.current
    setSearching(true)
    const timer = setTimeout(async () => {
      const all: Match[] = []
      let jumped = false
      for (let p = 0; p < pages.length; p++) {
        if (run !== runId.current) return
        try {
          all.push(...findInPage(await client.pageText(p), p, query, matchCase, wholeWord))
        } catch {
          continue // a page that fails to parse is skipped rather than ending the search
        }
        if (run !== runId.current) return
        if (all.length >= MAX_MATCHES) break
        const t = jumpTarget.current
        const targetAt = t ? all.findIndex((m) => m.page === t.page && m.from === t.from) : -1
        if (!jumped && (t ? targetAt >= 0 : all.length > 0)) {
          jumped = true
          jumpTarget.current = null
          const at = Math.max(0, targetAt)
          setMatches([...all])
          setCurrent(at)
          viewer.current?.scrollToMatch(all[at])
        } else if (p % 25 === 0) {
          setMatches([...all])
        }
      }
      if (run !== runId.current) return
      setMatches(all)
      if (!jumped && all.length) {
        // The target was not found (the file changed since): show the first match instead.
        jumpTarget.current = null
        setCurrent(0)
        viewer.current?.scrollToMatch(all[0])
      }
      if (!all.length) setCurrent(-1)
      setSearching(false)
    }, 200)
    return () => {
      clearTimeout(timer)
      runId.current++
    }
  }, [client, searchOpen, query, matchCase, wholeWord, pages.length])

  const stepMatch = useCallback((dir: 1 | -1) => {
    const list = matchesRef.current
    if (!list.length) return
    const next = (currentRef.current + dir + list.length) % list.length
    setCurrent(next)
    viewer.current?.scrollToMatch(list[next])
  }, [])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => {
      searchInput.current?.focus()
      searchInput.current?.select()
    })
  }, [])

  // ---- Keyboard -------------------------------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (ctrl && k === 's') {
        e.preventDefault()
        void save(e.shiftKey)
      } else if (ctrl && !inField && (k === 'z' || k === 'y')) {
        e.preventDefault()
        const redo = k === 'y' || e.shiftKey
        if (redo) (history.canRedo || !pageRedo.length ? history.redo : redoPageEdit)()
        else (history.canUndo || !pageUndo.length ? history.undo : undoPageEdit)()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && selectedAnnot !== null) {
        e.preventDefault()
        if (selIdsRef.current.size > 1) removeMany(selIdsRef.current)
        else removeAnnot(selectedAnnot)
      } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
      } else if (e.key === 'F3' || (ctrl && e.key.toLowerCase() === 'g')) {
        e.preventDefault()
        stepMatch(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        if (readingMode) setReadingMode(false)
        else if (printDialog) setPrintDialog(null)
        else if (searchOpen) setSearchOpen(false)
        else if (tool !== 'select') setTool('select')
        else if (selectedAnnot !== null) {
          setSelectedAnnot(null)
          setExtraSel(new Set())
        } else viewer.current?.clearSelection()
      } else if (ctrl && e.key.toLowerCase() === 'c' && !inField && viewer.current?.hasSelection()) {
        e.preventDefault()
        void viewer.current.copySelection()
      } else if (ctrl && e.shiftKey && (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd')) {
        e.preventDefault()
        rotateView(1)
      } else if (ctrl && e.shiftKey && (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract')) {
        e.preventDefault()
        rotateView(-1)
      } else if (ctrl && k === 'e') {
        e.preventDefault()
        setPropsOpen((o) => !o)
      } else if (ctrl && k === 'h') {
        e.preventDefault()
        setReadingMode((m) => !m)
      } else if (e.key === 'F5' && !ctrl) {
        e.preventDefault()
        void present()
      } else if (ctrl && k === 'p') {
        e.preventDefault()
        openPrint()
      } else if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        stepZoom(1)
      } else if (ctrl && e.key === '-') {
        e.preventDefault()
        stepZoom(-1)
      } else if (ctrl && e.key === '0') {
        e.preventDefault()
        setMode('fit-width')
      } else if (ctrl && e.key === '1') {
        e.preventDefault()
        setMode(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, searchOpen, tool, selectedAnnot, openSearch, rotateView, openPrint, printDialog, present, readingMode, stepMatch, stepZoom, save, removeAnnot, removeMany, history.undo, history.redo, history.canUndo, history.canRedo, pageUndo.length, pageRedo.length, undoPageEdit, redoPageEdit])

  // ---- Page box -------------------------------------------------------------------------------------
  const [pageText, setPageText] = useState('1')
  const [editingPage, setEditingPage] = useState(false)
  const pageName = (i: number) => pageLabels?.[i] || String(i + 1)
  useEffect(() => {
    if (!editingPage) setPageText(pageName(currentPage))
  }, [currentPage, editingPage, pageLabels]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A page label (as printed on the page, for example "iv") wins over a plain page number. */
  const commitPage = () => {
    setEditingPage(false)
    const t = pageText.trim()
    const byLabel = pageLabels ? pageLabels.findIndex((l) => l && l.toLowerCase() === t.toLowerCase()) : -1
    const n = parseInt(t, 10)
    if (byLabel >= 0) goTo(byLabel)
    else if (/^\d+$/.test(t) && Number.isFinite(n)) goTo(Math.min(pages.length, Math.max(1, n)) - 1)
    else setPageText(pageName(currentPage))
  }

  const zoomValue = typeof mode === 'number' ? (ZOOM_STEPS.includes(mode) ? String(mode) : 'custom') : mode
  const opPages = pageSel.length ? pageSel : [Math.min(currentPage, Math.max(0, pages.length - 1))]
  opPagesRef.current = pageSel
  const undoButtons = (
    <>
      <RB
        icon={Undo2}
        label="Undo"
        onClick={history.canUndo || !pageUndo.length ? history.undo : undoPageEdit}
        disabled={!history.canUndo && !pageUndo.length}
        title="Undo (Ctrl+Z)"
      />
      <RB
        icon={Redo2}
        label="Redo"
        onClick={history.canRedo || !pageRedo.length ? history.redo : redoPageEdit}
        disabled={!history.canRedo && !pageRedo.length}
        title="Redo (Ctrl+Y)"
      />
    </>
  )
  /** Colour, fill, line style and width, and Delete/Undo/Redo: shared by the Comment and Draw tabs. */
  const styleAndEdit = (
    <>
              <RGroup label={`${annotLabel(swatchKind)} style`}>
        <div className="rstyle">
          <span className="swatches" role="group" aria-label={`${annotLabel(swatchKind)} colour`}>
            {colorChoices(swatchKind).map((c) => (
              <button
                key={c}
                className={c === activeColor ? 'swatch on' : 'swatch'}
                style={{ background: c }}
                onClick={() => pickColor(c)}
                aria-label={`Colour ${c}`}
                aria-pressed={c === activeColor}
              />
            ))}
          </span>
          {canFill(swatchKind) && (
            <span className="swatches fill" role="group" aria-label="Fill colour">
              <button className={!activeFill ? 'swatch none on' : 'swatch none'} onClick={() => pickFill(undefined)} aria-label="No fill" aria-pressed={!activeFill} title="No fill" />
              {FILL_COLORS.map((c) => (
                <button key={c} className={c === activeFill ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => pickFill(c)} aria-label={`Fill ${c}`} aria-pressed={c === activeFill} title="Fill colour" />
              ))}
            </span>
          )}
          <div className="rstyle-row">
          {canDash(swatchKind) && (
            <select className="rselect" value={activeDash ?? 'solid'} onChange={(e) => pickDash(e.target.value === 'solid' ? undefined : (e.target.value as 'dashed' | 'dotted'))} aria-label="Line style" title="Line style">
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          )}
          {showWidth && (
            <select className="rselect" value={activeWidth} onChange={(e) => pickWidth(Number(e.target.value))} aria-label="Line width" title="Line width">
              {(LINE_WIDTHS.includes(activeWidth) ? LINE_WIDTHS : [...LINE_WIDTHS, activeWidth].sort((a, b) => a - b)).map((w) => (
                <option key={w} value={w}>
                  {w} pt
                </option>
              ))}
            </select>
          )}
          </div>
        </div>
      </RGroup>
      <RGroup label="Properties">
        <RB big icon={SlidersHorizontal} label="Properties" onClick={() => setPropsOpen((o) => !o)} pressed={propsOpen} title="Properties of the selection, or of the current tool (Ctrl+E)" />
        {toolPresets.length > 0 && (
          <select className="rselect" aria-label="Presets" value="" onChange={(e) => { const p = toolPresets.find((x) => x.id === e.target.value); if (p) applyPreset(p) }} title="Use a saved preset">
            <option value="">Presets…</option>
            {toolPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </RGroup>
      <RGroup label="Edit">
        <RB big icon={Trash2} label="Delete" onClick={() => selected && removeAnnot(selected.id)} disabled={!selected} title="Delete the selected annotation (Delete)" />
        <RStack>{undoButtons}</RStack>
      </RGroup>
    </>
  )

  return (
    <div className="docview" style={{ display: active ? 'flex' : 'none' }}>
      {readingMode && (
        <button className="reading-exit" onClick={() => setReadingMode(false)} title="Leave reading mode (Esc or Ctrl+H)">
          <X size={14} strokeWidth={2} aria-hidden />
          Leave reading mode
        </button>
      )}
      <div className="ribbon" hidden={readingMode}>
        <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
          {RIBBON_TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={ribbon === k} className={ribbon === k ? 'rtab on' : 'rtab'} onClick={() => setRibbon(k)}>
              {label}
            </button>
          ))}
        </div>
        <fieldset className="ribbon-body" role="tabpanel" disabled={locked && ribbon !== 'file' && ribbon !== 'home' && ribbon !== 'view'} aria-label={RIBBON_TABS.find(([k]) => k === ribbon)?.[1]}>
          {ribbon === 'file' && (
            <>
              <RGroup label="Document">
                <RB big icon={FolderOpen} label="Open" onClick={onOpen} title="Open a PDF (Ctrl+O)" />
                <RB big icon={Save} label="Save" badge={dirty} onClick={() => void save(false)} disabled={saving || !pages.length} title={dirty ? 'Save (Ctrl+S). There are unsaved changes' : 'Save (Ctrl+S)'} />
                <RB big icon={SaveAll} label="Save as" onClick={() => void save(true)} disabled={saving || !pages.length} title="Save a copy (Ctrl+Shift+S)" />
                <RB big icon={X} label="Close" onClick={onCloseDoc} title="Close this document (Ctrl+W)" />
              </RGroup>
              <RGroup label="Comments">
                <RB big icon={FileInput} label="Import" onClick={() => void importComments()} disabled={!pages.length} title="Import comments from an XFDF or FDF file" />
                <RStack>
                  <RB icon={FileOutput} label="Export XFDF" onClick={() => void exportComments('xfdf')} disabled={!commentAnnots.length} title="Export the comments as XFDF (XML)" />
                  <RB icon={GitCompare} label="Compare…" onClick={() => void compareWith()} disabled={!pages.length} title="Compare the comments with another copy of this document" />
                  <RB icon={FileOutput} label="Export FDF" onClick={() => void exportComments('fdf')} disabled={!commentAnnots.length} title="Export the comments as FDF" />
                </RStack>
              </RGroup>
              <RGroup label="Automate">
                <RB big icon={Puzzle} label="Plugins" onClick={() => setPluginsOpen(true)} title="Install and run plugins: small sandboxed scripts that make changes you choose" />
                <RB big icon={ListChecks} label="Batch" onClick={() => setBatchOpen(true)} title="Run a list of steps (watermark, page numbers, optimise, OCR, clean-up) over many PDFs" />
              </RGroup>
              <RGroup label="Security">
                <RB big icon={ShieldCheck} label="Security" onClick={() => setSecurityOpen(true)} disabled={!pages.length || busy || locked} title="Set or remove passwords and permissions (applied when you save)" />
              </RGroup>
              <RGroup label="Info">
                <RB big icon={FileText} label="Properties" onClick={() => void openDocProps()} disabled={!pages.length || busy || locked} title="Title, author, keywords and other document properties" />
                <RB big icon={BadgeCheck} label="Standards" onClick={() => void openStandards()} disabled={!pages.length || busy} title="What the file declares about PDF/A and PDF/UA, with basic checks" />
                <RB big icon={Archive} label="Convert to PDF/A" onClick={() => void makePdfA()} disabled={!pages.length || busy || locked} title="Make the file PDF/A-2b as far as this program can (best effort: check the result with a validator)" />
              </RGroup>
              <RGroup label="Output">
                <RB big icon={Printer} label="Print" onClick={openPrint} disabled={!pages.length || !!printing || permissions?.print === 'none'} title={permissions?.print === 'none' ? 'The owner of this document does not allow printing' : 'Print (Ctrl+P)'} />
              </RGroup>
            </>
          )}
          {ribbon === 'home' && (
            <>
              <RGroup label="Tools">
                <RB big icon={MousePointer2} label="Select" onClick={() => setTool('select')} disabled={!pages.length} pressed={tool === 'select'} title="Select text and annotations" />
                <RB big icon={Hand} label="Hand" onClick={() => setTool('hand')} disabled={!pages.length} pressed={tool === 'hand'} title="Hand tool: drag to pan" />
                <RB big icon={Camera} label="Snapshot" onClick={() => setTool(tool === 'snapshot' ? 'select' : 'snapshot')} disabled={!pages.length} pressed={tool === 'snapshot'} title="Snapshot: drag a box to copy that area as an image" />
                <RB big icon={ScanSearch} label="Zoom" onClick={() => setTool(tool === 'zoom' ? 'select' : 'zoom')} disabled={!pages.length} pressed={tool === 'zoom'} title="Zoom tool: drag a box to fit it, click to zoom in, Shift+click to zoom out" />
              </RGroup>
              <RGroup label="Edit">
                <RStack>
                  <RB icon={Copy} label="Copy" onClick={() => void viewer.current?.copySelection()} disabled={!hasTextSelection || permissions?.extract === false} title="Copy the selected text (Ctrl+C)" />
                  {undoButtons}
                </RStack>
              </RGroup>
              <RGroup label="Comment">
                <RB big icon={Highlighter} label="Highlight" onClick={() => void markSelection('highlight')} disabled={!hasTextSelection || locked} title="Highlight the selected text" />
                <RB big icon={StickyNote} label="Note" onClick={() => setTool(tool === 'note' ? 'select' : 'note')} disabled={!pages.length || locked} pressed={tool === 'note'} title="Add a sticky note: click on the page" />
              </RGroup>
              <RGroup label="Find">
                <RB big icon={Search} label="Find" onClick={openSearch} disabled={!pages.length} pressed={searchOpen} title="Find (Ctrl+F)" />
              </RGroup>
              <RGroup label="Document">
                <RB big icon={Save} label="Save" badge={dirty} onClick={() => void save(false)} disabled={saving || !pages.length} title={dirty ? 'Save (Ctrl+S). There are unsaved changes' : 'Save (Ctrl+S)'} />
                <RB big icon={Printer} label="Print" onClick={openPrint} disabled={!pages.length || !!printing || permissions?.print === 'none'} title={permissions?.print === 'none' ? 'The owner of this document does not allow printing' : 'Print (Ctrl+P)'} />
              </RGroup>
            </>
          )}
          {ribbon === 'comment' && (
            <>
              <RGroup label="Text markup">
                <RB big icon={Highlighter} label="Highlight" onClick={() => void markSelection('highlight')} disabled={!hasTextSelection} title="Highlight the selected text" />
                <RStack>
                  <RB icon={Underline} label="Underline" onClick={() => void markSelection('underline')} disabled={!hasTextSelection} title="Underline the selected text" />
                  <RB icon={Strikethrough} label="Strikeout" onClick={() => void markSelection('strikeout')} disabled={!hasTextSelection} title="Strike out the selected text" />
                  <RB icon={Waves} label="Squiggly" onClick={() => void markSelection('squiggly')} disabled={!hasTextSelection} title="Squiggly underline under the selected text" />
                </RStack>
                <RStack>
                  <RB icon={Replace} label="Replace text" onClick={() => void markSelection('strikeout', true)} disabled={!hasTextSelection} title="Strike out the selected text and type its replacement" />
                  <RB icon={TextCursorInput} label="Insert text" onClick={() => setTool(tool === 'caret' ? 'select' : 'caret')} disabled={!pages.length} pressed={tool === 'caret'} title="Mark where text should be inserted: click in the text, then type it" />
                </RStack>
              </RGroup>
              <RGroup label="Notes">
                <RB big icon={StickyNote} label="Note" onClick={() => setTool(tool === 'note' ? 'select' : 'note')} disabled={!pages.length} pressed={tool === 'note'} title="Add a sticky note: click on the page" />
                <RB big icon={Type} label="Text box" onClick={() => setTool(tool === 'textbox' ? 'select' : 'textbox')} disabled={!pages.length} pressed={tool === 'textbox'} title="Add a text box: click on the page" />
                <RStack>
                  <RB icon={Keyboard} label="Typewriter" onClick={() => setTool(tool === 'typewriter' ? 'select' : 'typewriter')} disabled={!pages.length} pressed={tool === 'typewriter'} title="Type straight onto the page: click where the text starts" />
                  <RB icon={Paperclip} label="Attach file" onClick={() => setTool(tool === 'fileattach' ? 'select' : 'fileattach')} disabled={!pages.length} pressed={tool === 'fileattach'} title="Attach a file: click on the page, then choose the file" />
                  <RB icon={Volume2} label="Sound" onClick={() => setTool(tool === 'sound' ? 'select' : 'sound')} disabled={!pages.length} pressed={tool === 'sound'} title="Attach a sound: click on the page, then choose a WAV recording" />
                  <RB icon={Link2} label="Link" onClick={() => setTool(tool === 'link' ? 'select' : 'link')} disabled={!pages.length} pressed={tool === 'link'} title="Add a link: drag a box, then choose a web address or a page" />
                  <RB icon={MessageSquareShare} label="Callout" onClick={() => setTool(tool === 'callout' ? 'select' : 'callout')} disabled={!pages.length} pressed={tool === 'callout'} title="Callout: drag from the point to call out to where the text box goes" />
                </RStack>
              </RGroup>
              <RGroup label="Stamp">
                <RB big icon={StampIcon} label="Stamp" onClick={() => setTool(tool === 'stamp' ? 'select' : 'stamp')} disabled={!pages.length} pressed={tool === 'stamp'} title="Place a stamp: click on the page" />
                <div className="menu-anchor stamp-anchor">
                  <button className="stamp-current" onClick={() => setStampPickerOpen((o) => !o)} aria-expanded={stampPickerOpen} aria-label="Choose stamp" title="Choose a stamp">
                    {stampChoice.kind === 'image' ? <img src={stampChoice.stamp.dataUrl} alt="" /> : <span>{stampChoice.label}</span>}
                    <ChevronDown size={14} aria-hidden />
                  </button>
                  {stampPickerOpen && (
                    <StampPicker
                      choice={stampChoice}
                      dated={stampDated}
                      images={stampImages}
                      onPick={pickStamp}
                      onDated={setStampDated}
                      onAddImages={() => void addStampImages()}
                      onRemoveImage={(id) => void removeStampImage(id)}
                      onClose={() => setStampPickerOpen(false)}
                    />
                  )}
                </div>
              </RGroup>
              {styleAndEdit}
            </>
          )}
          {ribbon === 'draw' && (
            <>
              <RGroup label="Drawing">
                <RStack>
                  <RB icon={Slash} label="Line" onClick={() => setTool(tool === 'line' ? 'select' : 'line')} disabled={!pages.length} pressed={tool === 'line'} title="Draw a line: drag. Hold Shift for 45 degree steps" />
                  <RB icon={MoveUpRight} label="Arrow" onClick={() => setTool(tool === 'arrow' ? 'select' : 'arrow')} disabled={!pages.length} pressed={tool === 'arrow'} title="Draw an arrow: drag. Hold Shift for 45 degree steps" />
                </RStack>
                <RStack>
                  <RB icon={Hexagon} label="Polygon" onClick={() => setTool(tool === 'polygon' ? 'select' : 'polygon')} disabled={!pages.length} pressed={tool === 'polygon'} title="Polygon: click the corners, double-click or Enter to finish" />
                </RStack>
                <RStack>
                  <RB icon={Square} label="Rectangle" onClick={() => setTool(tool === 'rectangle' ? 'select' : 'rectangle')} disabled={!pages.length} pressed={tool === 'rectangle'} title="Draw a rectangle: drag. Hold Shift for a square" />
                  <RB icon={Circle} label="Ellipse" onClick={() => setTool(tool === 'ellipse' ? 'select' : 'ellipse')} disabled={!pages.length} pressed={tool === 'ellipse'} title="Draw an ellipse: drag. Hold Shift for a circle" />
                  <RB icon={Spline} label="Polyline" onClick={() => setTool(tool === 'polyline' ? 'select' : 'polyline')} disabled={!pages.length} pressed={tool === 'polyline'} title="Polyline: click the points, double-click or Enter to finish" />
                </RStack>
                <RB big icon={Cloud} label="Cloud" onClick={() => setTool(tool === 'cloud' ? 'select' : 'cloud')} disabled={!pages.length} pressed={tool === 'cloud'} title="Revision cloud: click the corners, double-click or Enter to finish" />
                <RB big icon={EraserIcon} label="Eraser" onClick={() => setTool(tool === 'eraser' ? 'select' : 'eraser')} disabled={!pages.length} pressed={tool === 'eraser'} title="Eraser: drag over pencil strokes to rub them out" />
                <RB big icon={Pencil} label="Pencil" onClick={() => setTool(tool === 'ink' ? 'select' : 'ink')} disabled={!pages.length} pressed={tool === 'ink'} title="Draw freehand: drag" />
              </RGroup>
              {styleAndEdit}
            </>
          )}
          {ribbon === 'measure' && (
            <>
              <RGroup label="Measure">
                <RB big icon={Ruler} label="Distance" onClick={() => setTool(tool === 'measure-distance' ? 'select' : 'measure-distance')} disabled={!pages.length} pressed={tool === 'measure-distance'} title="Measure a distance: click two points. Shift keeps 45 degree steps" />
                <RB big icon={Spline} label="Perimeter" onClick={() => setTool(tool === 'measure-perimeter' ? 'select' : 'measure-perimeter')} disabled={!pages.length} pressed={tool === 'measure-perimeter'} title="Measure a path: click points, double-click or Enter to finish, Backspace to undo a point" />
                <RB big icon={Pentagon} label="Area" onClick={() => setTool(tool === 'measure-area' ? 'select' : 'measure-area')} disabled={!pages.length} pressed={tool === 'measure-area'} title="Measure an area: click the corners, double-click or Enter to finish" />
              </RGroup>
              <RGroup label="Scale">
                <RB big icon={Scaling} label="Calibrate" onClick={() => setTool(tool === 'calibrate' ? 'select' : 'calibrate')} disabled={!pages.length} pressed={tool === 'calibrate'} title="Set the scale: click both ends of a line of known length, then enter its real length" />
                <RStack>
                  <span className="rnote" title={scaleText}>
                    {scaleText}
                  </span>
                  <RB icon={RotateCcw} label="Use document scale" onClick={() => setCalibrated(null)} disabled={!calibrated} title="Forget the calibration and use the document's scale (or paper size)" />
                </RStack>
              </RGroup>
              <RGroup label="Results">
                <RStack>
                  <RB icon={Copy} label="Copy all" onClick={() => void copyMeasurements()} disabled={!measurements.length} title="Copy every measurement as text" />
                  <RB icon={Trash2} label="Clear all" onClick={() => history.commit((list) => list.filter((a) => !a.measure))} disabled={!measurements.length} title="Delete every measurement made in this session" />
                </RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'organise' && (
            <>
              <RGroup label={pageSel.length > 1 ? `Pages (${pageSel.length} selected)` : `Page ${opPages[0] + 1}`}>
                <RStack>
                  <RB icon={RotateCcwSquare} label="Rotate left" onClick={() => void runPageOp({ kind: 'rotate', delta: -90 }, opPages)} disabled={!pages.length || busy} title="Rotate the selected pages anticlockwise (changes the file)" />
                  <RB icon={RotateCwSquare} label="Rotate right" onClick={() => void runPageOp({ kind: 'rotate', delta: 90 }, opPages)} disabled={!pages.length || busy} title="Rotate the selected pages clockwise (changes the file)" />
                </RStack>
                <RB big icon={Trash2} label="Delete" onClick={() => void runPageOp({ kind: 'delete' }, opPages)} disabled={!pages.length || busy || opPages.length >= pages.length} title="Delete the selected pages" />
              </RGroup>
              <RGroup label="Copy">
                <RStack>
                  <RB icon={Copy} label="Copy pages" onClick={() => void runPageOp({ kind: 'copy' }, opPages)} disabled={!pages.length || busy} title="Copy the selected pages (Ctrl+C in the thumbnails)" />
                  <RB icon={ClipboardPaste} label="Paste pages" onClick={() => void runPageOp({ kind: 'paste', at: Math.max(...opPages) + 1 }, opPages)} disabled={!pages.length || busy || !hasPageClip} title="Paste copied pages after the selected pages (Ctrl+V in the thumbnails)" />
                  <RB icon={CopyPlus} label="Duplicate" onClick={() => void runPageOp({ kind: 'duplicate' }, opPages)} disabled={!pages.length || busy} title="Insert copies of the selected pages after them" />
                </RStack>
                <RB big icon={Replace} label="Replace" onClick={() => void runPageOp({ kind: 'replace' }, opPages)} disabled={!pages.length || busy} title="Replace the selected pages with pages from another PDF" />
              </RGroup>
              <RGroup label="Insert and extract">
                <RB big icon={FilePlus2} label="Insert" onClick={() => void runPageOp({ kind: 'insert', at: Math.max(...opPages) + 1 }, opPages)} disabled={!pages.length || busy} title="Insert pages from another PDF after the selected pages" />
                <RB big icon={FileOutput} label="Extract" onClick={() => void runPageOp({ kind: 'extract' }, opPages)} disabled={!pages.length || busy} title="Save the selected pages as a new PDF" />
              </RGroup>
              <RGroup label="Documents">
                <RB big icon={Files} label="Merge" onClick={mergeFiles} disabled={!pages.length || busy} title="Merge: add the pages of other PDFs to the end" />
                <RB big icon={Scissors} label="Split" onClick={() => void runPageOp({ kind: 'split' }, opPages)} disabled={!pages.length || busy} title="Split into files of a set number of pages" />
                <RB big icon={GitCompare} label="Compare" onClick={() => setCompareOpen(true)} disabled={!pages.length || busy} title="Compare this document with another PDF: the words, and how the pages look" />
              </RGroup>
              <RGroup label="Optimise">
                <RB big icon={Gauge} label="Optimise" onClick={() => setOptimising(true)} disabled={!pages.length || busy || locked} title="Make the file smaller: reduce pictures, compress, remove unused objects, linearise" />
              </RGroup>
              <RGroup label="Numbering">
                <RB big icon={Tags} label="Page labels" onClick={() => void openPageLabels()} disabled={!pages.length || busy || locked} title="Set the page numbers readers show (i, ii, 1, 2 …)" />
              </RGroup>
              <RGroup label="Edit">
                <RStack>{undoButtons}</RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'edit' && (
            <>
              <RGroup label="Text">
                <RB big icon={TextCursorInput} label="Edit text" onClick={() => setTool(tool === 'edittext' ? 'select' : 'edittext')} pressed={tool === 'edittext'} disabled={!pages.length || busy || locked} title="Click a line of text to change it (the text is redrawn in a matching standard font)" />
              </RGroup>
              <RGroup label="Align">
                <RStack>
                  <RB icon={AlignHorizontalJustifyStart} label="Left" onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'left' as AlignMode))} disabled={selectedIds.size < 2} title="Align the selected annotations to their left edge (Shift-click to select several)" />
                  <RB icon={AlignHorizontalJustifyCenter} label="Centre" onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'centre'))} disabled={selectedIds.size < 2} title="Centre the selected annotations horizontally" />
                  <RB icon={AlignHorizontalJustifyEnd} label="Right" onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'right'))} disabled={selectedIds.size < 2} title="Align to the right edge" />
                </RStack>
                <RStack>
                  <RB icon={AlignVerticalJustifyStart} label="Top" onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'top'))} disabled={selectedIds.size < 2} title="Align to the top edge" />
                  <RB icon={AlignVerticalJustifyCenter} label="Middle" onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'middle'))} disabled={selectedIds.size < 2} title="Centre vertically" />
                  <RB icon={AlignVerticalJustifyEnd} label="Bottom" onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'bottom'))} disabled={selectedIds.size < 2} title="Align to the bottom edge" />
                </RStack>
              </RGroup>
              <RGroup label="Distribute">
                <RStack>
                  <RB icon={AlignHorizontalDistributeCenter} label="Across" onClick={() => arrangeSelected((l, i) => distributeAnnots(l, i, 'horizontal'))} disabled={selectedIds.size < 3} title="Space three or more selected annotations evenly across the page" />
                  <RB icon={AlignVerticalDistributeCenter} label="Down" onClick={() => arrangeSelected((l, i) => distributeAnnots(l, i, 'vertical'))} disabled={selectedIds.size < 3} title="Space three or more selected annotations evenly down the page" />
                </RStack>
              </RGroup>
              <RGroup label="Order">
                <RStack>
                  <RB icon={BringToFront} label="To front" onClick={() => arrangeSelected((l, i) => restack(l, i, 'front' as StackMode), true)} disabled={!selectedIds.size} title="Draw the selected annotations on top of the others" />
                  <RB icon={ArrowUp} label="Forward" onClick={() => arrangeSelected((l, i) => restack(l, i, 'forward'), true)} disabled={!selectedIds.size} title="Move the selected annotations one step forward" />
                </RStack>
                <RStack>
                  <RB icon={SendToBack} label="To back" onClick={() => arrangeSelected((l, i) => restack(l, i, 'back'), true)} disabled={!selectedIds.size} title="Draw the selected annotations behind the others" />
                  <RB icon={ArrowDown} label="Backward" onClick={() => arrangeSelected((l, i) => restack(l, i, 'backward'), true)} disabled={!selectedIds.size} title="Move the selected annotations one step back" />
                </RStack>
              </RGroup>
              <RGroup label="Shapes">
                <RB big icon={Shapes} label="Edit shape" onClick={() => setTool(tool === 'editpath' ? 'select' : 'editpath')} pressed={tool === 'editpath'} disabled={!pages.length || busy || locked} title="Click a line, box or filled shape that is part of the page to move, resize or delete it" />
              </RGroup>
              <RGroup label="Images">
                <RB big icon={ImageIcon} label="Add image" onClick={() => void startAddImage()} pressed={tool === 'addimage'} disabled={!pages.length || busy || locked} title="Choose a PNG or JPEG, then click the page to place it as page content" />
                <RB big icon={ImageIcon} label="Edit image" onClick={() => setTool(tool === 'editimage' ? 'select' : 'editimage')} pressed={tool === 'editimage'} disabled={!pages.length || busy || locked} title="Click a picture to move it, resize it, replace it or delete it" />
              </RGroup>
              <RGroup label="Edit">
                <RStack>{undoButtons}</RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'forms' && (
            <>
              <RGroup label={formFields.length ? `Fill (${formFields.length} field${formFields.length === 1 ? '' : 's'})` : 'Fill'}>
                <RB big icon={Highlighter} label="Highlight fields" onClick={() => setHighlightFields(!highlightFields)} pressed={highlightFields} disabled={!formFields.length} title="Tint form fields so they are easy to find" />
                <RB big icon={Eraser} label="Clear form" onClick={resetForm} disabled={!formFields.length || busy} title="Empty every field" />
                <RB big icon={RotateCcw} label="Revert" onClick={() => setFormValues(new Map())} disabled={!formValues.size} title="Go back to the values saved in the file" />
              </RGroup>
              <RGroup label="Add a field">
                <RStack>
                  <RB icon={TextCursorInput} label="Text" onClick={() => startField('text')} pressed={tool === 'formfield' && fieldKind === 'text'} disabled={!pages.length || busy || locked} title="Draw a text field on the page" />
                  <RB icon={SquareCheck} label="Check box" onClick={() => startField('checkbox')} pressed={tool === 'formfield' && fieldKind === 'checkbox'} disabled={!pages.length || busy || locked} title="Draw a check box" />
                  <RB icon={CircleDot} label="Radio" onClick={() => startField('radio')} pressed={tool === 'formfield' && fieldKind === 'radio'} disabled={!pages.length || busy || locked} title="Draw a radio button (buttons with the same group name are exclusive)" />
                </RStack>
                <RStack>
                  <RB icon={SquareChevronDown} label="Drop-down" onClick={() => startField('dropdown')} pressed={tool === 'formfield' && fieldKind === 'dropdown'} disabled={!pages.length || busy || locked} title="Draw a drop-down list" />
                  <RB icon={List} label="List box" onClick={() => startField('list')} pressed={tool === 'formfield' && fieldKind === 'list'} disabled={!pages.length || busy || locked} title="Draw a list box" />
                  <RB icon={RectangleHorizontal} label="Button" onClick={() => startField('button')} pressed={tool === 'formfield' && fieldKind === 'button'} disabled={!pages.length || busy || locked} title="Draw a push button" />
                </RStack>
                <RB big icon={PenLine} label="Signature" onClick={() => startField('signature')} pressed={tool === 'formfield' && fieldKind === 'signature'} disabled={!pages.length || busy || locked} title="Draw a signature field" />
              </RGroup>
              <RGroup label="Find fields">
                <RB big icon={ScanSearch} label="Detect fields" onClick={() => void detectFormFields()} disabled={!pages.length || busy || locked || !client} title="Find blanks, lines, boxes and squares on the pages and make them into fields" />
              </RGroup>
              <RGroup label="Arrange fields">
                <RB big icon={SquareDashedMousePointer} label="Edit fields" onClick={() => setTool(tool === 'formedit' ? 'select' : 'formedit')} pressed={tool === 'formedit'} disabled={!formFields.length || busy || locked} title="Select, move, resize, rename or delete fields" />
                <RStack>
                  <RB icon={Rows3} label="Tab by rows" onClick={() => chooseTabOrder('rows')} pressed={formFields[0]?.widgets[0]?.tabs === 'R'} disabled={!formFields.length || busy || locked} title="Tab moves along each row, then down" />
                  <RB icon={Columns3} label="Tab by columns" onClick={() => chooseTabOrder('columns')} pressed={formFields[0]?.widgets[0]?.tabs === 'C'} disabled={!formFields.length || busy || locked} title="Tab moves down each column, then across" />
                  <RB icon={ListOrdered} label="Tab in field order" onClick={() => chooseTabOrder('structure')} pressed={formFields[0]?.widgets[0]?.tabs === 'S'} disabled={!formFields.length || busy || locked} title="Tab follows the order of the fields on the page (use Earlier and Later to change it)" />
                </RStack>
                <RStack>
                  <RB icon={ArrowUp} label="Earlier" onClick={() => stepTabOrder(-1)} disabled={!designSel || tool !== 'formedit' || busy} title="Move the selected field earlier in the tab order" />
                  <RB icon={ArrowDown} label="Later" onClick={() => stepTabOrder(1)} disabled={!designSel || tool !== 'formedit' || busy} title="Move the selected field later in the tab order" />
                </RStack>
              </RGroup>
              <RGroup label="Form data">
                <RB big icon={FileInput} label="Import…" onClick={() => void importFormData()} disabled={!formFields.length || busy} title="Fill the fields from an FDF, XFDF, CSV or XML file" />
                <RStack>
                  <RB icon={FileOutput} label="XFDF" onClick={() => void exportFormData('xfdf')} disabled={!formFields.length} title="Export the values as XFDF (XML)" />
                  <RB icon={FileOutput} label="FDF" onClick={() => void exportFormData('fdf')} disabled={!formFields.length} title="Export the values as FDF" />
                </RStack>
                <RStack>
                  <RB icon={FileOutput} label="CSV" onClick={() => void exportFormData('csv')} disabled={!formFields.length} title="Export the values as CSV (a row of names and a row of values)" />
                  <RB icon={FileOutput} label="XML" onClick={() => void exportFormData('xml')} disabled={!formFields.length} title="Export the values as XML" />
                </RStack>
              </RGroup>
              <RGroup label="Finish">
                <RB big icon={Layers2} label="Flatten" onClick={() => void applyPageEdit(async (b) => (await flattenForm(b)).bytes, 'Form flattened: the fields are now part of the pages')} disabled={!formFields.length || busy || locked} title="Make the fields part of the page so they can no longer be edited" />
              </RGroup>
              {!formFields.length && <p className="muted ribbon-note">This document has no form fields.</p>}
            </>
          )}
          {ribbon === 'redact' && (
            <>
              <RGroup label="Mark">
                <RB big icon={EyeOff} label="Mark area" onClick={() => setTool(tool === 'redact' ? 'select' : 'redact')} pressed={tool === 'redact'} disabled={!pages.length || busy || locked} title="Drag a box over what is to be removed" />
                <RB big icon={TextSelect} label="Mark text" onClick={() => void markSelectionForRedaction()} disabled={!pages.length || busy || locked} title="Mark the text you have selected" />
                <RB big icon={Search} label="Mark search" onClick={() => void markSearchForRedaction()} disabled={!pages.length || busy || locked} title="Mark every match of the current search (Ctrl+F to search)" />
              </RGroup>
              <RGroup label="Apply">
                <RB big icon={ShieldAlert} label="Apply" onClick={() => setRedactConfirm(true)} disabled={!redactMarks.length || busy || locked} title="Permanently remove what is under the marks" />
                <RB big icon={X} label="Clear marks" onClick={() => setRedactMarks([])} disabled={!redactMarks.length} title="Take all the marks off without removing anything" />
              </RGroup>
              <RGroup label="Sanitise">
                <RB big icon={Eraser} label="Hidden information" onClick={() => void openSanitise()} disabled={!pages.length || busy || locked} title="Find and remove metadata, attached files, scripts and other things that are not on the pages" />
              </RGroup>
            </>
          )}
          {ribbon === 'convert' && (
            <>
            <RGroup label="Export">
              <RB big icon={ImageIcon} label="Pictures" onClick={() => setExportImagesOpen(true)} disabled={!pages.length || busy} title="Save the pages as PNG, JPEG or TIFF pictures" />
              <RB big icon={FileText} label="Text" onClick={() => void exportAs('txt')} disabled={!pages.length || busy} title="Save the text of the document as a plain text file" />
              <RB big icon={Globe} label="HTML" onClick={() => void exportAs('html')} disabled={!pages.length || busy} title="Save the text as a web page, with headings and paragraphs (pictures and layout are not kept)" />
              <RB big icon={FileOutput} label="Word" onClick={() => void exportAs('docx')} disabled={!pages.length || busy} title="Save the text as a Word document, with headings and paragraphs (best effort: pictures and layout are not kept)" />
            </RGroup>
            <RGroup label="Recognise">
              <RB big icon={ScanText} label="OCR" onClick={() => setOcrOpen(true)} disabled={!pages.length || busy || locked} title="Recognise the text in scanned pages so they can be searched and copied" />
            </RGroup>
            <RGroup label="Scan">
              <RB big icon={ScanLine} label="Scan" onClick={() => setScanOpen(true)} disabled={busy} title="Scan paper with a scanner connected to this computer" />
            </RGroup>
            <RGroup label="Create PDF">
              <RB big icon={ImageIcon} label="From pictures" onClick={() => void pickToCreate('images')} disabled={busy} title="Make a PDF from PNG, JPEG, GIF, BMP, WebP or TIFF pictures, one per page" />
              <RB big icon={FileText} label="From text" onClick={() => void pickToCreate('text')} disabled={busy} title="Make a PDF from a plain text file" />
              <RB big icon={Globe} label="From web page" onClick={() => void makeNew('Could not convert the web page', () => window.openpdf.htmlToPdf())} disabled={busy} title="Make a PDF from a saved .html file (scripts and network access are off)" />
              <RB big icon={Paperclip} label="Portfolio" onClick={() => void window.openpdf.pickFiles().then((f) => f.length && setPortfolioFiles(f))} disabled={busy} title="Package several files of any kind in one PDF portfolio" />
              <RB big icon={FileInput} label="From Office file" onClick={() => void makeNew('Could not convert the file', () => window.openpdf.officeToPdf())} disabled={busy} title={officeReady ? 'Make a PDF from a Word, Excel or PowerPoint file (uses LibreOffice)' : 'Needs LibreOffice, which is not installed'} />
              <RB big icon={ClipboardPaste} label="From clipboard" onClick={() => void fromPicture('Could not create the PDF', () => window.openpdf.clipboardImage(), 'Clipboard.pdf', 'There is no picture on the clipboard.')} disabled={busy} title="Make a PDF from the picture on the clipboard" />
              <RB big icon={Camera} label="Screenshot" onClick={() => void fromPicture('Could not take the screenshot', () => window.openpdf.screenshot(), `Screenshot ${today()}.pdf`, 'The screen could not be captured.')} disabled={busy} title="Make a PDF from a picture of the whole screen" />
            </RGroup>
            </>
          )}
          {ribbon === 'sign' && (
            <RGroup label="Signatures">
              <RB big icon={FileSignature} label="Sign document" onClick={() => setSignOpen(true)} disabled={!pages.length || busy || locked} title="Sign with a certificate from Windows or a certificate file" />
              <RB big icon={ShieldCheck} label="Signatures" onClick={() => setSigPanel(true)} disabled={!pages.length} title="Check who signed this document and whether it has changed since" />
            </RGroup>
          )}
          {ribbon === 'layout' && (
            <>
              <RGroup label="Header and footer">
                <RB big icon={PanelTop} label="Header & footer" onClick={() => setMarksMode('headerfooter')} disabled={!pages.length || busy} title="Add a header and footer to pages" />
                <RStack>
                  <RB icon={Hash} label="Page numbers" onClick={() => setMarksMode('pagenumbers')} disabled={!pages.length || busy} title="Add page numbers" />
                  <RB icon={Barcode} label="Bates numbers" onClick={() => setMarksMode('bates')} disabled={!pages.length || busy} title="Add Bates numbers (prefix and running number)" />
                </RStack>
              </RGroup>
              <RGroup label="Watermark">
                <RB big icon={Droplets} label="Watermark" onClick={() => setMarksMode('watermark')} disabled={!pages.length || busy} title="Add a text or picture watermark" />
                <RB big icon={PaintBucket} label="Background" onClick={() => setMarksMode('background')} disabled={!pages.length || busy} title="Add a background colour or picture behind the pages" />
              </RGroup>
              <RGroup label="Page size">
                <RStack>
                  <RB icon={Crop} label="Crop…" onClick={() => setMarksMode('crop')} disabled={!pages.length || busy} title="Crop pages by margins" />
                  <RB icon={SquareDashed} label="Crop tool" onClick={() => setTool(tool === 'crop' ? 'select' : 'crop')} pressed={tool === 'crop'} disabled={!pages.length || busy} title="Drag a box on a page to crop to it (the selected thumbnails get the same box)" />
                  <RB icon={Maximize2} label="Resize…" onClick={() => setMarksMode('resize')} disabled={!pages.length || busy} title="Change the paper size of pages" />
                </RStack>
              </RGroup>
              <RGroup label="Remove">
                <RB big icon={Eraser} label="Remove marks" onClick={() => setMarksMode('remove')} disabled={!pages.length || busy || !presentMarks.size} title="Remove headers, footers, numbers, watermarks or backgrounds added with OpenPDF" />
              </RGroup>
            </>
          )}
          {ribbon === 'view' && (
            <>
              <RGroup label="Panes">
                <RB big icon={LayoutGrid} label="Pages" onClick={() => setSidebar(sidebar === 'pages' ? null : 'pages')} pressed={sidebar === 'pages'} title="Show or hide page thumbnails" />
                <RB big icon={Bookmark} label="Bookmarks" onClick={() => setSidebar(sidebar === 'bookmarks' ? null : 'bookmarks')} pressed={sidebar === 'bookmarks'} title="Show or hide bookmarks" />
                <RStack>
                  <RB icon={PanelLeft} label="Dock left" onClick={() => onPaneSide('left')} pressed={paneSide === 'left'} title="Dock the side pane on the left" />
                  <RB icon={PanelRight} label="Dock right" onClick={() => onPaneSide('right')} pressed={paneSide === 'right'} title="Dock the side pane on the right" />
                </RStack>
              </RGroup>
              <RGroup label="Page display">
                <RB big icon={FileText} label="Single" onClick={() => setPageMode({ ...pageMode, twoUp: false })} pressed={!pageMode.twoUp} disabled={!pages.length} title="One page per row" />
                <RB big icon={Columns2} label="Two pages" onClick={() => setPageMode({ ...pageMode, twoUp: true })} pressed={pageMode.twoUp} disabled={!pages.length} title="Two pages side by side" />
                <RStack>
                  <RB icon={GalleryVertical} label="Continuous" onClick={() => setPageMode({ ...pageMode, continuous: !pageMode.continuous })} pressed={pageMode.continuous} disabled={!pages.length} title="Scroll through all pages, or show one page (or pair) at a time" />
                  <RB icon={BookOpen} label="Cover page" onClick={() => setPageMode({ ...pageMode, cover: !pageMode.cover })} pressed={pageMode.cover} disabled={!pages.length || !pageMode.twoUp} title="With two pages: show the first page on its own, like a book cover" />
                </RStack>
              </RGroup>
              <RGroup label="Zoom">
                <RB big icon={ScanSearch} label="Zoom tool" onClick={() => setTool(tool === 'zoom' ? 'select' : 'zoom')} disabled={!pages.length} pressed={tool === 'zoom'} title="Zoom tool: drag a box to fit it, click to zoom in, Shift+click to zoom out" />
                <RStack>
                  <RB icon={ArrowLeftRight} label="Fit width" onClick={() => setMode('fit-width')} disabled={!pages.length} pressed={mode === 'fit-width'} title="Fit width (Ctrl+0)" />
                  <RB icon={Expand} label="Fit page" onClick={() => setMode('fit-page')} disabled={!pages.length} pressed={mode === 'fit-page'} title="Fit page" />
                </RStack>
                <RStack>
                  <RB icon={Scan} label="Actual size" onClick={() => setMode(1)} disabled={!pages.length} pressed={mode === 1} title="Actual size (Ctrl+1)" />
                  <RB icon={ZoomIn} label="Zoom in" onClick={() => stepZoom(1)} disabled={!pages.length} title="Zoom in (Ctrl++)" />
                </RStack>
              </RGroup>
              <RGroup label="Rulers and grid">
                <RStack>
                  <RB icon={Ruler} label="Rulers" onClick={() => setAids({ ...aids, rulers: !aids.rulers })} pressed={aids.rulers} disabled={!pages.length} title="Show rulers. Drag from a ruler to add a guide; drag a guide back to remove it" />
                  <RB icon={Grid3x3} label="Grid" onClick={() => setAids({ ...aids, grid: aids.grid ? null : (10 * 72) / 25.4 })} pressed={!!aids.grid} disabled={!pages.length} title="Show a grid over the pages" />
                  <RB icon={Magnet} label="Snap" onClick={() => setAids({ ...aids, snap: !aids.snap })} pressed={aids.snap} disabled={!pages.length} title="Snap drawing and measuring to the grid and guides" />
                </RStack>
                <RStack>
                  <select className="rselect" aria-label="Ruler units" value={aids.unit} onChange={(e) => setAids({ ...aids, unit: e.target.value as ViewAids['unit'] })} title="Ruler units">
                    <option value="mm">Millimetres</option>
                    <option value="cm">Centimetres</option>
                    <option value="in">Inches</option>
                    <option value="pt">Points</option>
                  </select>
                  <select
                    className="rselect"
                    aria-label="Grid spacing"
                    value={aids.grid ? String(Math.round((aids.grid * 25.4) / 72)) : '10'}
                    onChange={(e) => setAids({ ...aids, grid: (Number(e.target.value) * 72) / 25.4 })}
                    title="Grid spacing"
                  >
                    {GRID_MM.map((g) => (
                      <option key={g} value={g}>
                        Grid {g} mm
                      </option>
                    ))}
                  </select>
                  <RB icon={Eraser} label="Clear guides" onClick={() => setGuides([])} disabled={!guides.length} title="Remove all guides" />
                </RStack>
              </RGroup>
              <RGroup label="Read aloud">
                {readerState === 'idle' ? (
                  <RB big icon={Volume2} label="Read" onClick={() => void readAloud()} disabled={!pages.length || !voices.length} title={voices.length ? 'Read aloud from this page, or the selected text' : 'No speech voices are installed'} />
                ) : (
                  <RB
                    big
                    icon={readerState === 'paused' ? Play : Pause}
                    label={readerState === 'paused' ? 'Resume' : 'Pause'}
                    onClick={() => (readerState === 'paused' ? reader.current?.resume() : reader.current?.pause())}
                    title={readerState === 'paused' ? 'Resume reading' : 'Pause reading'}
                  />
                )}
                <RStack>
                  <RB icon={CircleStop} label="Stop" onClick={() => reader.current?.stop()} disabled={readerState === 'idle'} title="Stop reading" />
                  <select className="rselect" aria-label="Reading speed" value={speechRate} onChange={(e) => setSpeechRate(Number(e.target.value))} title="Reading speed (applies next time)">
                    {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <option key={r} value={r}>
                        {r}×
                      </option>
                    ))}
                  </select>
                </RStack>
                {voices.length > 1 && (
                  <select className="rselect" aria-label="Voice" value={voiceURI ?? ''} onChange={(e) => setVoiceURI(e.target.value || undefined)} title="Voice (applies next time)">
                    <option value="">Default voice</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                )}
              </RGroup>
              <RGroup label="Reading">
                <RB big icon={BookOpenText} label="Reading mode" onClick={() => setReadingMode(true)} disabled={!pages.length} title="Hide the ribbon and side pane (Ctrl+H). Esc to leave" />
                <RStack>
                  <RB icon={Sun} label="Normal colours" onClick={() => setPageColours('normal')} pressed={pageColours === 'normal'} title="Show pages in their own colours" />
                  <RB icon={Moon} label="Night" onClick={() => setPageColours('night')} pressed={pageColours === 'night'} title="Light text on dark pages (view only)" />
                  <RB icon={Contrast} label="High contrast" onClick={() => setPageColours('contrast')} pressed={pageColours === 'contrast'} title="High-contrast pages (view only)" />
                </RStack>
              </RGroup>
              <RGroup label="Show">
                <RB big icon={PresentationIcon} label="Present" onClick={() => void present()} disabled={!pages.length} title="Full-screen presentation from this page (F5). Esc to leave" />
              </RGroup>
              <RGroup label="Rotate view">
                <RB big icon={RotateCcw} label="Left" ariaLabel="Rotate view anticlockwise" onClick={() => rotateView(-1)} disabled={!pages.length} title="Rotate view anticlockwise (Ctrl+Shift+−). The file is not changed" />
                <RB big icon={RotateCw} label="Right" ariaLabel="Rotate view clockwise" onClick={() => rotateView(1)} disabled={!pages.length} title="Rotate view clockwise (Ctrl+Shift++). The file is not changed" />
              </RGroup>
            </>
          )}
        </fieldset>
      </div>

      {lockReason && (
        <div className="info banner lock-banner" role="status">
          {lockReason}
          <button type="button" onClick={() => setOwnerPrompt({ draft: '', wrong: false })}>
            Enter the permissions password…
          </button>
        </div>
      )}
      {sigRows.length > 0 && (
        <div className={sigRows.some((r) => signatureState(r).level === 'bad') ? 'error banner' : 'info banner'} role="status">
          {(() => {
            const states = sigRows.map(signatureState)
            const worst = states.find((x) => x.level === 'bad') ?? states.find((x) => x.level === 'warn')
            const who = sigRows.map((r) => r.check.signer?.commonName ?? r.info.name ?? 'unknown').join(', ')
            return worst ? `Signed by ${who}. ${worst.text}` : `Signed by ${who}. ${sigRows.length === 1 ? 'The signature is valid.' : 'All signatures are valid.'}`
          })()}
          <button type="button" onClick={() => setSigPanel(true)}>
            Signature details…
          </button>
        </div>
      )}
      {notice && (
        <div className={notice.kind === 'error' ? 'error banner' : 'info banner'} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
          {notice.kind === 'error' && (
            <IconButton icon={X} label="Dismiss" onClick={() => setNotice(null)} />
          )}
        </div>
      )}

      {searchOpen && (
        <div className="searchbar" role="search">
          <input
            ref={searchInput}
            type="search"
            value={query}
            placeholder="Find in document"
            aria-label="Find in document"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
            }}
          />
          <IconButton icon={ChevronUp} label="Previous match" title="Previous match (Shift+Enter)" onClick={() => stepMatch(-1)} disabled={!matches.length} />
          <IconButton icon={ChevronDown} label="Next match" title="Next match (Enter)" onClick={() => stepMatch(1)} disabled={!matches.length} />
          <label>
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
          </label>
          <label>
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word
          </label>
          <span className="muted search-status" aria-live="polite">
            {!query
              ? ''
              : matches.length
                ? `${current + 1} of ${matches.length}${matches.length >= MAX_MATCHES ? '+' : ''}${searching ? '…' : ''}`
                : searching
                  ? 'Searching…'
                  : 'No results'}
          </span>
          <IconButton icon={X} className="close" label="Close find" title="Close (Esc)" onClick={() => setSearchOpen(false)} />
        </div>
      )}

      {presenting && (
        <Presentation
          bytes={presenting.bytes}
          password={undefined}
          start={presenting.start}
          onExit={(p) => {
            setPresenting(null)
            goTo(p)
          }}
        />
      )}

      {marksMode && (
        <PageMarksDialog
          mode={marksMode}
          pageCount={pages.length}
          currentPage={currentPage}
          selected={pageSel}
          present={presentMarks}
          onPickImage={async () => (await window.openpdf.pickFile({ name: 'Pictures', ext: ['png', 'jpg', 'jpeg'] }))?.data ?? null}
          onApply={(r) => void applyMarks(r)}
          onClose={() => setMarksMode(null)}
        />
      )}

      {detected && <DetectDialog found={detected} onApply={(c) => void createDetected(c)} onClose={() => setDetected(null)} />}
      {fieldDraft && <FieldDialog type={fieldDraft.type} names={formFields.map((f) => f.name)} sourceNames={formFields.filter((f) => f.type === 'text' || f.type === 'dropdown').map((f) => f.name)} proposedName={proposeName(fieldDraft.type)} onCreate={(s) => void createField(s)} onUpdate={() => {}} onClose={() => setFieldDraft(null)} />}
      {fieldEdit &&
        (() => {
          const f = formFields.find((x) => x.name === fieldEdit)
          return f ? <FieldDialog key={f.name} type={f.type} field={f} names={formFields.map((x) => x.name)} sourceNames={formFields.filter((x) => x.type === 'text' || x.type === 'dropdown').map((x) => x.name)} proposedName={f.name} onCreate={() => {}} onUpdate={(n, p) => void changeField(n, p)} onClose={() => setFieldEdit(null)} /> : null
        })()}

      {securityOpen && (
        <SecurityDialog
          protectedNow={protection.kind !== 'none'}
          describe={protection.kind === 'new' ? `${protection.options.keyLength}-bit AES${protection.options.userPassword ? ', password to open' : ''}` : permissions && restrictsEditing(permissions) ? `not allowed: ${describeRestrictions(permissions)}` : ''}
          onClose={() => setSecurityOpen(false)}
          onApply={(options) => {
            setProtection({ kind: 'new', options })
            setProtectionDirty(true)
            setSecurityOpen(false)
            setNotice({ kind: 'info', text: 'Security set. Save to write the protected file.' })
          }}
          onRemove={() => {
            setProtection({ kind: 'none' })
            setProtectionDirty(true)
            setSecurityOpen(false)
            setNotice({ kind: 'info', text: 'Security removed. Save to write the unprotected file.' })
          }}
        />
      )}
      {scanOpen && <ScanDialog onScan={runScan} onClose={() => setScanOpen(false)} />}
      {ocrOpen && <OcrDialog pageCount={pages.length} currentPage={currentPage} onRun={(r) => void runOcr(r)} onClose={() => setOcrOpen(false)} />}
      {portfolioFiles && (
        <PortfolioDialog
          files={portfolioFiles.map((f) => f.name)}
          onClose={() => setPortfolioFiles(null)}
          onCreate={(title, cover) => {
            const files = portfolioFiles
            setPortfolioFiles(null)
            void makeNew('Could not create the portfolio', async () => ({ name: `${title}.pdf`, data: await createPortfolio(files.map((f) => ({ name: f.name, data: f.data })), { title, cover }) }))
          }}
        />
      )}
      {pluginsOpen && client && (
        <PluginsDialog
          onClose={() => setPluginsOpen(false)}
          onRun={async (plugin, action, params) => {
            const doc = await describeDocument(client, pages, name, await readProps(bytes))
            const outcome = normaliseResult(await runPluginScript(plugin.scripts[action.id], doc, params), plugin.manifest.permits)
            if (outcome.error) throw new Error(outcome.error)
            if (outcome.steps.length) {
              const env = await appEnv()
              await applyPageEdit(async (b) => (await runSteps(b, name, outcome.steps, env)).bytes)
            }
            return `${outcome.message || `${plugin.manifest.name}: ${action.label} done.`}${outcome.steps.length ? '' : ' (It asked for no changes.)'}${outcome.dropped ? ` ${outcome.dropped} request${outcome.dropped === 1 ? ' was' : 's were'} not allowed by its permissions and ignored.` : ''}`
          }}
        />
      )}
      {compareOpen && client && <CompareDocsDialog current={{ name, client, pages }} onClose={() => setCompareOpen(false)} />}
      {batchOpen && <BatchDialog onClose={() => setBatchOpen(false)} />}
      {exportImagesOpen && <ExportImagesDialog pageCount={pages.length} currentPage={currentPage} onExport={(r) => void runExportImages(r)} onClose={() => setExportImagesOpen(false)} />}
      {createFrom && <CreateDialog kind={createFrom.kind} files={createFrom.files.map((f) => f.name)} onCreate={runCreate} onClose={() => setCreateFrom(null)} />}
      {signOpen && <SignDialog canCertify={sigRows.length === 0} onSign={startSign} onClose={() => setSignOpen(false)} />}
      {sigPanel && <SignaturesDialog rows={sigRows} onClose={() => setSigPanel(false)} />}
      {breakPrompt && (
        <Modal title="This document is signed" onClose={() => { breakPrompt(false); setBreakPrompt(null) }}>
          <div className="marks-form">
            <p>
              Making this change will invalidate {validSigs === 1 ? 'its signature' : `its ${validSigs} signatures`}: they will show that the document was changed after it was signed.
            </p>
            <div className="marks-actions">
              <button type="button" onClick={() => { breakPrompt(false); setBreakPrompt(null) }}>
                Cancel
              </button>
              <button className="primary" type="button" onClick={() => { breakPrompt(true); setBreakPrompt(null) }}>
                Change anyway
              </button>
            </div>
          </div>
        </Modal>
      )}
      {hidden && (
        <SanitiseDialog
          found={hidden}
          onClose={() => setHidden(null)}
          onApply={(o) => {
            setHidden(null)
            let removed: HiddenInfo | null = null
            void applyPageEdit(async (b) => {
              const r = await sanitise(b, o)
              removed = r.bytes.length ? r.removed : null
              return r.bytes
            }).then(() => {
              const r = removed as HiddenInfo | null
              if (!r) return
              const parts = (Object.entries(r) as [string, number][]).filter(([, n]) => n > 0).map(([k]) => k)
              setNotice({ kind: 'info', text: parts.length ? `Removed hidden information: ${parts.join(', ')}.` : 'Nothing was removed.' })
            })
          }}
        />
      )}
      {redactConfirm && (
        <Modal title="Apply redactions" onClose={() => setRedactConfirm(false)}>
          <div className="marks-form">
            <p>
              {redactMarks.length} marked area{redactMarks.length === 1 ? '' : 's'} on {new Set(redactMarks.map((m) => m.page)).size} page{new Set(redactMarks.map((m) => m.page)).size === 1 ? '' : 's'}. The text, images and shapes under them are removed from the pages and each area is covered with a black box.
            </p>
            <p className="muted">Text is removed a whole line at a time, so a line that is only partly marked goes entirely. Once the file is saved this cannot be undone.</p>
            <div className="marks-actions">
              <button type="button" onClick={() => setRedactConfirm(false)}>
                Cancel
              </button>
              <button className="primary" type="button" onClick={() => void applyRedactions()}>
                Redact
              </button>
            </div>
          </div>
        </Modal>
      )}
      {ownerPrompt && (
        <Modal title="Permissions password" onClose={() => setOwnerPrompt(null)}>
          <form
            className="marks-form"
            onSubmit={(e) => {
              e.preventDefault()
              void unlockOwner(ownerPrompt.draft)
            }}
          >
            <p>Enter the permissions (owner) password to allow editing.</p>
            <input type="password" aria-label="Permissions password" autoFocus value={ownerPrompt.draft} onChange={(e) => setOwnerPrompt({ draft: e.target.value, wrong: false })} />
            {ownerPrompt.wrong && (
              <p className="error-text" role="alert">
                That is not the permissions password.
              </p>
            )}
            <div className="marks-actions">
              <button type="button" onClick={() => setOwnerPrompt(null)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={!ownerPrompt.draft}>
                Unlock
              </button>
            </div>
          </form>
        </Modal>
      )}

      {standards && (
        <StandardsDialog
          report={standards}
          conversion={conversion}
          onClose={() => {
            setStandards(null)
            setConversion(undefined)
          }}
        />
      )}
      {docProps && (
        <DocPropsDialog
          initial={docProps}
          fileName={name}
          pageCount={pages.length}
          size={bytes.length}
          onClose={() => setDocProps(null)}
          onApply={(p) => {
            setDocProps(null)
            void applyPageEdit((b) => writeProps(b, p), 'Document properties updated')
          }}
          onRemove={() => {
            setDocProps(null)
            void applyPageEdit((b) => removeProps(b), 'All metadata removed')
          }}
        />
      )}

      {optimising && <OptimiseDialog size={bytes.length} onApply={(o) => void runOptimise(o)} onClose={() => setOptimising(false)} />}

      {labelRanges && (
        <PageLabelsDialog
          initial={labelRanges}
          pageCount={pages.length}
          currentPage={currentPage}
          onClose={() => setLabelRanges(null)}
          onApply={(r) => {
            setLabelRanges(null)
            void applyPageEdit((b) => writeLabelRanges(b, r), r.length ? 'Page labels updated' : 'Page labels removed')
          }}
        />
      )}

      {linkDraft && (
        <form
          className="page-dialog"
          aria-label="Link target"
          onSubmit={(e) => {
            e.preventDefault()
            finishLink()
          }}
        >
          <span className="muted">Link to</span>
          <label className="inline">
            <input type="radio" checked={linkDraft.to === 'uri'} onChange={() => setLinkDraft({ ...linkDraft, to: 'uri' })} /> Web address
          </label>
          <input aria-label="Web address" className="wide" value={linkDraft.uri} disabled={linkDraft.to !== 'uri'} onChange={(e) => setLinkDraft({ ...linkDraft, uri: e.target.value })} autoFocus />
          <label className="inline">
            <input type="radio" checked={linkDraft.to === 'page'} onChange={() => setLinkDraft({ ...linkDraft, to: 'page' })} /> Page
          </label>
          <input aria-label="Target page" className="copies" value={linkDraft.page1} disabled={linkDraft.to !== 'page'} onChange={(e) => setLinkDraft({ ...linkDraft, page1: e.target.value })} />
          <button className="primary" type="submit">
            {linkDraft.id !== undefined ? 'Save link' : 'Add link'}
          </button>
          <button type="button" onClick={() => setLinkDraft(null)}>
            Cancel
          </button>
        </form>
      )}

      {calibrating && (
        <form
          className="page-dialog"
          aria-label="Calibrate scale"
          onSubmit={(e) => {
            e.preventDefault()
            try {
              setCalibrated(calibrate(calibrating.lengthPt, Number(calibrating.real.replace(',', '.')), calibrating.unit))
              setCalibrating(null)
              setTool('measure-distance')
            } catch (err) {
              setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
            }
          }}
        >
          <span className="muted">The line is {formatLength(calibrating.lengthPt, PAPER_MM)} on paper. Its real length is</span>
          <input
            autoFocus
            className="copies"
            aria-label="Real length"
            inputMode="decimal"
            value={calibrating.real}
            onChange={(e) => setCalibrating({ ...calibrating, real: e.target.value })}
          />
          <select aria-label="Unit" value={calibrating.unit} onChange={(e) => setCalibrating({ ...calibrating, unit: e.target.value })}>
            {LENGTH_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <button className="primary" type="submit">
            Set scale
          </button>
          <button type="button" onClick={() => setCalibrating(null)}>
            Cancel
          </button>
        </form>
      )}

      {printDialog && (
        <form
          className="page-dialog print-dialog"
          aria-label="Print"
          onSubmit={(e) => {
            e.preventDefault()
            void runPrint(printDialog)
          }}
        >
          <span className="muted">Print</span>
          <select
            aria-label="Pages to print"
            value={printDialog.range}
            onChange={(e) => setPrintDialog({ ...printDialog, range: e.target.value as PrintChoice['range'] })}
          >
            <option value="all">All pages</option>
            <option value="current">Current page ({currentPage + 1})</option>
            <option value="custom">Pages…</option>
          </select>
          {printDialog.range === 'custom' && (
            <input
              autoFocus
              aria-label="Page range, for example 1-3, 5"
              title="For example 1-3, 5"
              value={printDialog.custom}
              onChange={(e) => setPrintDialog({ ...printDialog, custom: e.target.value })}
            />
          )}
          <label>
            Copies
            <input
              type="number"
              min={1}
              max={999}
              className="copies"
              value={printDialog.copies}
              onChange={(e) => setPrintDialog({ ...printDialog, copies: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
            />
          </label>
          <select
            aria-label="Pages per sheet"
            value={String(printDialog.perSheet)}
            onChange={(e) => {
              const v = e.target.value
              setPrintDialog({ ...printDialog, perSheet: v === 'booklet' ? 'booklet' : (Number(v) as PrintChoice['perSheet']) })
            }}
          >
            <option value="1">1 page per sheet</option>
            {[2, 4, 6, 9, 16].map((n) => (
              <option key={n} value={n}>
                {n} pages per sheet
              </option>
            ))}
            <option value="booklet">Booklet (double-sided, fold)</option>
          </select>
          <select
            aria-label="Page scaling"
            disabled={printDialog.perSheet !== 1}
            value={printDialog.fit ? 'fit' : 'actual'}
            onChange={(e) => setPrintDialog({ ...printDialog, fit: e.target.value === 'fit' })}
          >
            <option value="fit">Fit to paper</option>
            <option value="actual">Actual size</option>
          </select>
          <label title="Turn landscape pages so they fill portrait paper">
            <input type="checkbox" disabled={printDialog.perSheet !== 1} checked={printDialog.autoRotate} onChange={(e) => setPrintDialog({ ...printDialog, autoRotate: e.target.checked })} />
            Auto-rotate
          </label>
          <button className="primary" type="submit">
            Print…
          </button>
          <button type="button" onClick={() => setPrintDialog(null)}>
            Cancel
          </button>
        </form>
      )}

      {printing && (
        <div className="page-dialog print-progress" role="status">
          <span>
            Preparing pages for printing: {printing.done} of {printing.total}
          </span>
          <button type="button" onClick={() => printing.ctrl.abort()}>
            Cancel
          </button>
        </div>
      )}

      {pageDialog && (
        <form
          className="page-dialog"
          onSubmit={(e) => {
            e.preventDefault()
            void submitPageDialog()
          }}
        >
          {pageDialog.kind === 'split' && (
            <label>
              Split
              <select
                aria-label="Split by"
                value={pageDialog.mode}
                onChange={(e) => {
                  const mode = e.target.value as 'count' | 'bookmarks' | 'size'
                  setPageDialog({ ...pageDialog, mode })
                  setDialogText(mode === 'size' ? '5' : '1')
                }}
              >
                <option value="count">Every N pages</option>
                <option value="bookmarks" disabled={!outline?.length}>
                  At each top-level bookmark
                </option>
                <option value="size">By file size</option>
              </select>
            </label>
          )}
          {!(pageDialog.kind === 'split' && pageDialog.mode === 'bookmarks') && (
            <label>
              {pageDialog.kind === 'extract'
                ? 'Pages to extract (for example 1-3, 5)'
                : pageDialog.kind === 'replace'
                  ? 'Replace these pages'
                  : pageDialog.mode === 'size'
                    ? 'Largest file size (MB)'
                    : 'Pages per file'}
              <input autoFocus aria-label={pageDialog.kind === 'replace' ? 'Pages to replace' : undefined} value={dialogText} onChange={(e) => setDialogText(e.target.value)} />
            </label>
          )}
          {pageDialog.kind === 'replace' && (
            <label>
              With pages of {pageDialog.other.name} (1-{pageDialog.otherCount})
              <input aria-label="Replacement pages" value={pageDialog.theirs} onChange={(e) => setPageDialog({ ...pageDialog, theirs: e.target.value })} />
            </label>
          )}
          <button className="primary" type="submit">
            {pageDialog.kind === 'extract' ? 'Extract…' : pageDialog.kind === 'replace' ? 'Replace' : 'Split…'}
          </button>
          <button type="button" onClick={() => setPageDialog(null)}>
            Cancel
          </button>
        </form>
      )}

      <div className={paneSide === 'right' ? 'body pane-right' : 'body'}>
        {error ? (
          <div className="error">{error}</div>
        ) : passwordIssue ? (
          <form
            className="password-form"
            onSubmit={(e) => {
              e.preventDefault()
              unlock(passwordDraft)
                .then((ok) => !ok && setPasswordIssue('wrong'))
                .catch(() => setPasswordIssue('wrong'))
            }}
          >
            <p>{passwordIssue === 'wrong' ? 'That password is incorrect.' : 'This document is password protected.'}</p>
            <input
              type="password"
              autoFocus
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              aria-label="Document password"
            />
            <button className="primary" type="submit" disabled={!passwordDraft}>
              Open
            </button>
          </form>
        ) : !client ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            {sidebar && !readingMode && (
              <Sidebar
                client={client}
                pages={pages}
                outline={outline}
                tab={sidebar}
                onTab={setSidebar}
                currentPage={currentPage}
                onGoTo={goTo}
                onPageOp={(op, sel) => void runPageOp(op, sel)}
                busy={busy}
                width={paneWidth}
                onSelectionChange={setPageSel}
                labels={pageLabels}
                attachments={attachments}
                onSaveAttachment={(a) => void saveAttachment(a)}
                onAddAttachments={locked ? undefined : () => void addAttachments()}
                onRemoveAttachment={locked ? undefined : removeAttachment}
                onSaveAllAttachments={() => void saveAllAttachments()}
                layers={layers}
                isLayerVisible={(key) => (hiddenLayers ? !hiddenLayers.has(key) : layers.find((l) => l.key === key)?.defaultOn !== false)}
                onToggleLayer={toggleLayer}
                onEditOutline={locked ? undefined : editOutline}
                comments={
                  <CommentsPane
                    annots={commentAnnots}
                    labels={pageLabels}
                    selectedId={selectedAnnot}
                    onFocus={focusComment}
                    onReply={addReply}
                    onStatus={setReviewState}
                    onDeleteReply={deleteReply}
                    onSummarise={() => void summariseComments()}
                    onExportCsv={() => void exportCommentsCsv()}
                  />
                }
              />
            )}
            {sidebar && !readingMode && (
              <div
                className="splitter"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize side pane"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startW = paneWidth
                  let w = startW
                  const move = (ev: MouseEvent) => {
                    const dx = (ev.clientX - startX) * (paneSide === 'right' ? -1 : 1)
                    w = Math.min(600, Math.max(140, startW + dx))
                    setPaneWidth(w)
                  }
                  const up = () => {
                    window.removeEventListener('mousemove', move)
                    window.removeEventListener('mouseup', up)
                    onSidebarWidth(w)
                  }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
              />
            )}
            <Viewer
              ref={viewer}
              client={client}
              pages={pages}
              zoom={zoom}
              rotation={rotation}
              mode={pageMode}
              onZoomTo={zoomTo}
              onSnapshot={(page, rect) => void takeSnapshot(page, rect)}
              pageColours={pageColours}
              measurements={[]}
              onMeasure={onMeasure}
              measureLabel={measureLabel}
              aids={aids}
              guides={guides}
              onGuides={setGuides}
              onErase={eraseInk}
              onCropRect={cropToRect}
              onRedactRect={(page, rect) => (tool === 'signbox' && pendingSign ? void doSign(pendingSign, { page, rect }) : addMarks([{ page, rect }]))}
              redactMarks={redactMarks}
              onUnmark={(id) => setRedactMarks((m) => m.filter((x) => x.id !== id))}
              onLinkRect={(page, rect) => setLinkDraft({ page, rect, to: 'uri', uri: 'https://', page1: String(Math.min(pages.length, page + 2)) })}
              onChangeImage={(page, obj, total, change) =>
                void applyPageEdit((b) => transformImage(b, { page, ordinal: obj.ordinal, total, matrix: obj.matrix }, change), change ? 'Image updated' : 'Image deleted')
              }
              onChangePath={(page, obj, total, change) =>
                void applyPageEdit((b) => transformPath(b, { page, ordinal: obj.ordinal, total, pageBounds: obj.pageBounds }, change), change ? 'Shape updated' : 'Shape deleted')
              }
              onReplaceImage={async (page, obj, total) => {
                const file = await window.openpdf.pickFile({ name: 'Pictures', ext: ['png', 'jpg', 'jpeg'] })
                if (!file) return
                const d = file.data
                const kind = d[0] === 0x89 && d[1] === 0x50 ? 'png' : d[0] === 0xff && d[1] === 0xd8 ? 'jpg' : null
                if (!kind) {
                  setNotice({ kind: 'error', text: 'That file is not a PNG or JPEG picture.' })
                  return
                }
                await applyPageEdit((b) => replaceImage(b, { page, ordinal: obj.ordinal, total, matrix: obj.matrix }, { data: d, kind }), 'Image replaced')
              }}
              textEditReady={clientBytes === viewBytes && (hiddenLayers !== null || viewBytes === bytes) && !busy}
              onEditText={(page, block, total, text) => {
                let hidden = false
                void applyPageEdit(async (b) => {
                  const style = { font: block.font, flags: block.flags, weight: block.weight, italic: block.italic, size: block.size, color: block.color, matrix: block.matrix }
                  const { bold, italic } = weightAndSlant(style)
                  const installed = text ? await window.openpdf.findFont(block.font, bold, italic).catch(() => null) : null
                  const r = await replaceBlock(b, { page, ordinals: block.ordinals, total, origins: block.origins }, text, style, installed?.data, block.reflow ? block.layout : null)
                  hidden = r.hiddenOriginal
                  return r.bytes
                }, text ? 'Text updated' : 'Text deleted').then(() => {
                  if (hidden) setNotice({ kind: 'info', text: 'Text updated. The old text stays in the file, hidden, because the text after it depends on its width.' })
                })
              }}
              onFollowLink={(l) => (l.page !== undefined ? goTo(l.page) : l.uri ? void window.openpdf.openLink(l.uri) : undefined)}
              tool={tool}
              annots={annots}
              selectedAnnot={selectedAnnot}
              extraSelected={extraSel}
              onFieldRect={(page, rect) => setFieldDraft({ type: fieldKind, page, rect })}
              forms={
                formFields.length || tool === 'formfield' || tool === 'formedit'
                  ? {
                      fields: formFields,
                      values: formValues,
                      onChange: setFormValue,
                      highlight: highlightFields,
                      onButton: pressFormButton,
                      onCommit: (f, v) => void commitField(f, v),
                      display: displayed,
                      design: tool === 'formedit' ? { selected: designSel, onSelect: setDesignSel, onPlace: moveField, onEdit: setFieldEdit, onDelete: (n) => void removeField(n) } : undefined
                    }
                  : undefined
              }
              editingAnnot={editingAnnot}
              onSelectAnnot={selectAnnot}
              onMoveAnnot={moveAnnot}
              onResizeAnnot={resizeAnnot}
              onEditAnnot={editAnnot}
              touchedAnnots={touched}
              onTouchAnnot={touch}
              epoch={epoch}
              onAnnotText={finishText}
              onPlace={placeTool}
              drawStyle={{ color: colors[toolKind ?? 'line'], lineWidth: styleMap[toolKind ?? 'line']?.lineWidth ?? drawWidth }}
              onCreateShape={createShape}
              onReshapeAnnot={reshapeAnnot}
              onSelectionChange={setHasTextSelection}
              matches={matches}
              currentMatch={current}
              onPageChange={setCurrentPage}
              onSize={onSize}
            />
            {comparison && (
              <ComparePanel
                otherName={comparison.otherName}
                result={comparison.result}
                onFocus={(a) => {
                  void viewer.current?.scrollToRect(a.page, a.rects[0])
                  if (annots.some((x) => x.id === a.id)) setSelectedAnnot(a.id)
                }}
                onAdd={(a) => adoptTheirs([a])}
                onAddAll={() => adoptTheirs(comparison.result.onlyTheirs)}
                onTakeTheirs={takeTheirsAt}
                onClose={() => setComparison(null)}
              />
            )}
            {propsOpen && (
              <PropertiesPanel
                annot={selected}
                kind={swatchKind}
                style={panelStyle}
                onStyle={applyStyle}
                onAuthor={setAuthorOf}
                onMakeDefault={makeDefault}
                presets={toolPresets}
                onSavePreset={savePreset}
                onUsePreset={applyPreset}
                onDeletePreset={(id) => onSettings({ toolPresets: toolPresets.filter((p) => p.id !== id) })}
                onClose={() => setPropsOpen(false)}
              />
            )}
          </>
        )}
      </div>
      <div className="statusbar toolbar" role="toolbar" aria-label="Page and zoom">
        <IconButton icon={PanelLeft} label="Side panel" title="Show or hide the side panel" onClick={() => setSidebar(sidebar ? null : 'pages')} pressed={sidebar !== null} />
        <span className="sep" />
        <IconButton icon={ChevronUp} label="Previous page" onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 0} />
        <input
          className="page-input"
          value={pageText}
          aria-label="Page number"
          onFocus={(e) => {
            setEditingPage(true)
            e.currentTarget.select()
          }}
          onChange={(e) => setPageText(e.target.value)}
          onBlur={commitPage}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setEditingPage(false)
              setPageText(pageName(currentPage))
              e.currentTarget.blur()
            }
          }}
        />
        <span className="muted">{pageLabels ? `(${currentPage + 1} of ${pages.length})` : `/ ${pages.length || '–'}`}</span>
        <IconButton icon={ChevronDown} label="Next page" onClick={() => goTo(currentPage + 1)} disabled={currentPage >= pages.length - 1} />
        <span className="status-fill" />
        <IconButton icon={ZoomOut} label="Zoom out" title="Zoom out (Ctrl+−)" onClick={() => stepZoom(-1)} disabled={!pages.length} />
        <select
          value={zoomValue}
          disabled={!pages.length}
          aria-label="Zoom"
          onChange={(e) => {
            const v = e.target.value
            if (v === 'fit-width' || v === 'fit-page') setMode(v)
            else if (v !== 'custom') setMode(Number(v))
          }}
        >
          <option value="fit-width">Fit width</option>
          <option value="fit-page">Fit page</option>
          {zoomValue === 'custom' && <option value="custom">{Math.round(zoom * 100)}%</option>}
          {ZOOM_STEPS.map((s) => (
            <option key={s} value={s}>
              {Math.round(s * 100)}%
            </option>
          ))}
        </select>
        <span className="muted zoom-now" title="Current zoom">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton icon={ZoomIn} label="Zoom in" title="Zoom in (Ctrl++)" onClick={() => stepZoom(1)} disabled={!pages.length} />
      </div>
    </div>
  )
}
