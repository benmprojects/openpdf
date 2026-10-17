import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FONT_SIZE,
  NOTE_SIZE,
  TEXTBOX_DEFAULT,
  annotLabel,
  colorChoices,
  DEFAULT_LINE_WIDTH,
  LINE_WIDTHS,
  defaultColor,
  isShapeKind,
  isMarkup,
  hasFont,
  type ToolStyle,
  eraseFromPaths,
  canDash,
  canFill,
  canBlend,
  canCloud,
  canLineEnds,
  isLocked,
  FLAG_LOCKED,
  FLAG_PRINT,
  withFlag,
  signature,
  type Reply,
  type ReviewState,
  parseWav,
  TEXTBOX_PADDING,
  translated,
  typewriterRect,
  withBounds,
  type Annot,
  type AnnotKind,
  type Pt
} from './annotations'
import { writeAnnotations, type DeletedAnnot } from './annotWrite'
import { deletePages, extractPages, insertPagesFrom, mergeDocuments, movePages, rotatePages } from './pageOps'
import { DeleteDialog, DuplicateDialog, ExtractDialog, InsertDialog, MergeDialog, MoveDialog, ReplaceDialog, RotateDialog, SplitDialog } from './PageOpsDialogs'
import type { DocContext, PageDialogKind, PageDialogResult } from './pageDialogLogic'
import { applyDialogEdit, buildExtractFiles, buildSplitFiles, doneMessage } from './pageDialogRun'
import { CommentsDialog, ExportTextDialog, FlattenDialog, SaveAsDialog, type CommentFormat, type CommentsDialogResult, type SaveAsChoice } from './CommandDialogs'
import { applyFilter, type CommentFilter } from './commentFilter'
import { flattenDocument, flattenSignatures, type FlattenWhat } from './flatten'
import { getPageClip, onPageClip, setPageClip } from './pageClipboard'
import { PdfClient, type AttachmentInfo, type OutlineNode, type PageSize } from './pdfClient'
import { Sidebar, type PageOp, type SidebarTab } from './Sidebar'
import { findInPage, hitTest, normaliseNewlines, rangeRects, type Match } from './textLogic'
import { BatchDialog } from './BatchDialog'
import { MediaPlayerDialog } from './MediaPlayerDialog'
import { findMedia, type MediaItem } from './media'
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
import { CombineDialog } from './CombineDialog'
import { SignaturesDialog, signatureState, type SignatureRow } from './SignaturesDialog'
import { addTimestamp, buildTimestampRequest, prepareSignature, readSignatures, verifySignature } from './sign'
import { sanitise, scanHidden, type HiddenInfo } from './sanitise'
import { redactPages, type RedactMark, type RedactReport } from './redact'
import { useHistory } from './useHistory'
import { DEFAULT_MODE, layoutRows, rowExtent, type PageMode } from './pageLayout'
import { GAP, PAD, Viewer, type Tool, type ViewAids, type ViewerHandle } from './Viewer'
import type { Guide } from './GuideLayer'
import { encodeRotatedPng, printDocument } from './print'
import { PrintDialog, type PrintJob } from './PrintDialog'
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
import { applyFormValues, readForm, type FieldType, type FormField, type FormValue } from './forms'
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
import { applyStyle as applyStyleTo, cleanStyle, styleOf } from './commentStyle'
import { commentsCsv, commentSummaryPdf } from './commentReport'
import { fromFdf, fromNorms, fromXfdf, pageFrames, toFdf, toNorms, toXfdf } from './interchange'
import { StampPicker } from './StampPicker'
import { useStamps } from './useStamps'
import { useSignatures } from './useSignatures'
import { Reader, type ReaderState } from './readAloud'
import type { MeasureKind } from './MeasureLayer'
import { calibrate, formatArea, formatLength, pathLength, PAPER_MM, polygonArea, readViewports, resultLabel, scaleAt, type Scale, type Viewport } from './measure'
import { ScaleDialog } from './ScaleDialog'
import { MeasurePane } from './MeasurePane'
import { measureCsv, measureRows, nextCount } from './measureList'
import { writePageScales } from './measureWrite'
import { ALL_SNAPS, type SnapKinds } from './snap'
import type { ScalePreset } from './measureScale'
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
  Scale as ScaleIcon,
  Triangle,
  Diamond,
  Download,
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
  ArrowUpDown,
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
  Combine,
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
import { msg, t } from './i18n'

type ZoomMode = 'fit-width' | 'fit-page' | number

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
  ['file', msg('File')],
  ['home', msg('Home')],
  ['edit', msg('Edit')],
  ['forms', msg('Forms')],
  ['redact', msg('Redact')],
  ['sign', msg('Sign')],
  ['convert', msg('Convert')],
  ['comment', msg('Comment')],
  ['draw', msg('Draw')],
  ['measure', msg('Measure')],
  ['organise', msg('Organise')],
  ['layout', msg('Layout')],
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
  // The Pages-tab dialog that is open, and the pages it should start from (the thumbnail selection or menu target).
  const [pageDialog, setPageDialog] = useState<{ kind: PageDialogKind; selection: number[]; insertAfter?: number } | null>(null)
  /** Options dialogs for Flatten, Export text, Comments import/export and Save as. */
  const [cmdDialog, setCmdDialog] = useState<
    { kind: 'flatten' } | { kind: 'export'; as: 'txt' | 'html' | 'docx' } | { kind: 'comments'; mode: 'import' | 'export'; format: CommentFormat } | { kind: 'saveas' } | null
  >(null)
  /** The Combine files dialog (File and Organize tabs). */
  const [combineOpen, setCombineOpen] = useState(false)
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
  /** A scale was set here and is not yet written into the file as viewport measure dictionaries. */
  const [scaleDirty, setScaleDirty] = useState(false)
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
      if (stamps.captureSnapshot(png)) return
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
  const [media, setMedia] = useState<MediaItem[] | null>(null)
  const [player, setPlayer] = useState<MediaItem | null>(null)
  const saveMedia = async (m: MediaItem) => {
    const saved = await window.openpdf.saveAttachment(m.name, m.read())
    if (saved) setNotice({ kind: 'info', text: `Saved ${saved}` })
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
  const [lastMarkup, setLastMarkup] = useState<AnnotKind>('highlight')
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  // Media is looked for when its tab is shown (reading the structure of a large file takes a moment).
  useEffect(() => {
    if (sidebar !== 'media') return
    let live = true
    setMedia(null)
    findMedia(bytes)
      .then((m) => live && setMedia(m))
      .catch(() => live && setMedia([]))
    return () => {
      live = false
    }
  }, [sidebar, bytes])
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
  const annotsDirty = annotWork || formValues.size > 0 || protectionDirty || scaleDirty
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
    // Scales set here go into the file as viewport measure dictionaries, one per page, for other viewers.
    if (scaleDirtyRef.current) out = await writePageScales(out, pages.map((_, i) => userScaleFor(i)))
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
      ...(hasFont(kind) && s.fontSize ? { fontSize: s.fontSize } : {}),
      ...(canLineEnds(kind) && s.lineStart ? { lineStart: s.lineStart } : {}),
      ...(canLineEnds(kind) && s.lineEnd ? { lineEnd: s.lineEnd } : {}),
      ...(canCloud(kind) && s.cloud !== undefined ? { cloud: s.cloud } : {}),
      ...(canBlend(kind) && s.blend ? { blend: s.blend } : {})
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

  const stamps = useStamps({
    author,
    pages,
    ctx: { count: pages.length, current: Math.min(currentPage, Math.max(0, pages.length - 1)), selected: [], sizes: pages },
    commit: history.commit,
    newAnnot,
    select: setSelectedAnnot,
    setTool,
    notify: setNotice,
    selected: annots.find((a) => a.id === selectedAnnot) ?? null,
    update: (id, fn) => {
      touch(id)
      history.commit((list) => list.map((a) => (a.id === id ? fn(a) : a)))
    }
  })
  useEffect(() => {
    if (tool !== 'snapshot') stamps.cancelCapture()
  }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Signature and initials library (Sign tab): pictures of a signature, not certificate signatures. */
  const signatures = useSignatures(stamps, author, setNotice)
  const flattenPlacedSignatures = () => {
    let note = ''
    void applyPageEdit(async (b) => {
      const r = await flattenSignatures(b)
      note = r.count ? `Flattened ${r.count} signature picture${r.count === 1 ? '' : 's'}: now part of the pages` : 'There are no signature pictures to flatten'
      return r.count ? r.bytes : null
    }).then(() => note && setNotice({ kind: 'info', text: note }))
  }

  const place = useCallback(
    async (kind: 'note' | 'textbox' | 'stamp' | 'caret' | 'typewriter' | 'fileattach' | 'sound', page: number, x: number, y: number, box?: { w: number; h: number }) => {
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
      if (kind === 'stamp') {
        // Stamps are placed by the stamp palette's own logic (fields, numbering, sizing, pages).
        await stamps.place(page, x, y, box)
        return
      }
      const w = kind === 'note' ? NOTE_SIZE : TEXTBOX_DEFAULT.w
      const h = kind === 'note' ? NOTE_SIZE : TEXTBOX_DEFAULT.h
      const rect = { x: Math.max(0, Math.min(size.width - w, x)), y: Math.max(0, Math.min(size.height - h, y)), w, h }
      const a = newAnnot(kind, page, [rect], '')
      history.commit((list) => [...list, a])
      setSelectedAnnot(a.id)
      setEditingAnnot(a.id)
      setTool('select')
    },
    [pages, colors, author, history.commit] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** Eraser: rub out ink on one page. One undo step for the whole stroke. */
  const eraseInk = useCallback(
    (page: number, trail: Pt[], radius: number) => {
      const hits = annotsRef.current.filter((a) => a.page === page && a.kind === 'ink' && !isLocked(a) && a.points && eraseFromPaths(a.points, trail, radius))
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
      const a: Annot = withBounds({
        author: authorRef.current || undefined,
        created: new Date().toISOString(),
        ...shape,
        id: nextAnnotId.current++,
        ...(canFill(shape.kind) && fillsRef.current[shape.kind] ? { fill: fillsRef.current[shape.kind] } : {}),
        ...(canDash(shape.kind) && dashesRef.current[shape.kind] ? { dash: dashesRef.current[shape.kind] } : {}),
        ...extraStyle(shape.kind)
      })
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
          if (a.id !== id || !a.points || isLocked(a)) return a
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
          if (!ids.has(a.id) || isLocked(a)) return a
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
          if (a.id !== id || isLocked(a)) return a
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
      // A locked comment cannot be deleted (untick Locked in the Properties panel first).
      if (annotsRef.current.find((a) => a.id === id && isLocked(a))) return
      touch(id)
      history.commit((list) => list.filter((a) => a.id !== id))
      setSelectedAnnot((s) => (s === id ? null : s))
      setEditingAnnot((e) => (e === id ? null : e))
    },
    [history.commit, touch]
  )

  const removeMany = useCallback(
    (ids: ReadonlySet<number>) => {
      // Locked comments stay.
      ids = new Set([...ids].filter((id) => !annotsRef.current.some((a) => a.id === id && isLocked(a))))
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
      if (id !== null && annotsRef.current.some((a) => a.id === id && isLocked(a))) return
      if (id !== null) touch(id)
      setEditingAnnot(id)
    },
    [touch]
  )

  const finishText = useCallback(
    (id: number, text: string) => {
      setEditingAnnot(null)
      const existing = annotsRef.current.find((a) => a.id === id)
      if (!existing || isLocked(existing)) return
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
    if (selected && !isLocked(selected)) touch(selected.id)
    if (selected && !isLocked(selected)) history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, color: c } : a)))
  }

  const pickWidth = (w: number) => {
    setDrawWidth(w)
    setStyleMap((m) => ({ ...m, [swatchKind]: { ...m[swatchKind], lineWidth: w } }))
    if (selected && !isLocked(selected) && (isShapeKind(selected.kind) || selected.kind === 'stamp')) {
      touch(selected.id)
      history.commit((list) => list.map((a) => (a.id === selected.id ? withBounds({ ...a, lineWidth: w }) : a)))
    }
  }


  const activeFill = selected ? selected.fill : fills[swatchKind]
  const activeDash = selected ? selected.dash : dashes[swatchKind]
  const pickFill = (c: string | undefined) => {
    setFills((f) => ({ ...f, [swatchKind]: c }))
    if (selected && !isLocked(selected) && canFill(selected.kind)) {
      touch(selected.id)
      history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, fill: c } : a)))
    }
  }
  const pickDash = (d: 'dashed' | 'dotted' | undefined) => {
    setDashes((x) => ({ ...x, [swatchKind]: d }))
    if (selected && !isLocked(selected) && canDash(selected.kind)) {
      touch(selected.id)
      history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, dash: d } : a)))
    }
  }

  // ---- Properties panel and tool presets ------------------------------------------------------------
  const [propsOpen, setPropsOpen] = useState(false)
  const panelStyle: ToolStyle & { color: string } = selected
    ? { lineWidth: selected.lineWidth, fontSize: selected.fontSize, ...styleOf(selected) }
    : { ...(styleMap[swatchKind] ?? {}), color: colors[swatchKind], fill: fills[swatchKind], dash: dashes[swatchKind], lineWidth: styleMap[swatchKind]?.lineWidth ?? drawWidth }
  /** Applies a style change to the selected annotation, or to the current tool. */
  const applyStyle = (patch: ToolStyle) => {
    if (selected) {
      if (isLocked(selected)) {
        setNotice({ kind: 'info', text: 'This comment is locked. Untick Locked in the Properties panel to change it.' })
        return
      }
      touch(selected.id)
      history.commit((list) =>
        list.map((a) => {
          if (a.id !== selected.id) return a
          const next: Annot = { ...a, ...patch, ...(patch.opacity === 1 ? { opacity: undefined } : {}) }
          if ('fill' in patch && !canFill(a.kind)) delete next.fill
          if (a.kind === 'typewriter' && (patch.fontSize || patch.fontFamily)) next.rects = [typewriterRect(a.rects[0].x, a.rects[0].y, a.text, next.fontSize)]
          return patch.lineWidth !== undefined || 'lineStart' in patch || 'lineEnd' in patch || 'cloud' in patch ? withBounds(next) : next
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
    if (!selected || isLocked(selected)) return
    touch(selected.id)
    history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, author: author || undefined } : a)))
  }
  const makeDefault = () => {
    onSettings({ toolDefaults: { ...toolDefaults, [swatchKind]: cleanStyle(panelStyle) } })
    setNotice({ kind: 'info', text: `New ${annotLabel(swatchKind).toLowerCase()} annotations will use this style` })
  }
  const savePreset = (presetName: string) => {
    onSettings({ toolPresets: [...toolPresets, { id: crypto.randomUUID(), name: presetName, kind: swatchKind, style: cleanStyle(panelStyle) }] })
  }
  /** A saved style becomes the default for its tool. */
  const presetAsDefault = (p: ToolPreset) => {
    onSettings({ toolDefaults: { ...toolDefaults, [p.kind]: p.style } })
    setNotice({ kind: 'info', text: `New ${annotLabel(p.kind as AnnotKind).toLowerCase()} annotations will use the style "${p.name}"` })
  }
  /** Gives a saved style to every selected comment (locked ones are left alone). */
  const applyPresetToSelected = (p: ToolPreset) => {
    const ids = selIdsRef.current
    const targets = annotsRef.current.filter((a) => ids.has(a.id) && !isLocked(a) && a.kind !== 'foreign' && a.kind !== 'link')
    if (!targets.length) return
    targets.forEach((a) => touch(a.id))
    const set = new Set(targets.map((a) => a.id))
    history.commit((list) => list.map((a) => (set.has(a.id) ? applyStyleTo(a, p.style) : a)))
    setNotice({ kind: 'info', text: `Applied "${p.name}" to ${targets.length} comment${targets.length === 1 ? '' : 's'}` })
  }
  /** Printable and Locked flags of the selected comment (these work on a locked comment: that is how it is unlocked). */
  const setFlags = (patch: { printable?: boolean; locked?: boolean }) => {
    if (!selected) return
    touch(selected.id)
    history.commit((list) =>
      list.map((a) => {
        if (a.id !== selected.id) return a
        let next = a
        if (patch.printable !== undefined) next = withFlag(next, FLAG_PRINT, patch.printable)
        if (patch.locked !== undefined) next = withFlag(next, FLAG_LOCKED, patch.locked)
        return next
      })
    )
  }

  // ---- Comments list: show/hide on the page (the view only), bulk status, deleting, selecting ----
  const [hiddenComments, setHiddenComments] = useState<ReadonlySet<number>>(() => new Set())
  const setCommentsHidden = (ids: number[], hide: boolean) => {
    // Annotations of other tools that we only keep as they are ("foreign") stay drawn by PDFium, so they cannot be hidden.
    const foreign = new Set(annotsRef.current.filter((a) => a.kind === 'foreign').map((a) => a.id))
    const target = ids.filter((id) => !foreign.has(id))
    // An imported comment is drawn by PDFium until touched, so hiding one hands it to our overlay first.
    if (hide) target.forEach(touch)
    setHiddenComments((h) => {
      const next = new Set(h)
      for (const id of target) {
        if (hide) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }
  const setStatusMany = (ids: number[], state: ReviewState) => {
    const reply = (): Reply => ({ id: nextAnnotId.current++, author: authorRef.current, text: '', date: new Date().toISOString(), state })
    const set = new Set(ids)
    history.commit((list) => list.map((a) => (set.has(a.id) ? { ...a, replies: [...(a.replies ?? []), reply()] } : a)))
  }
  const selectComments = (ids: number[]) => {
    setSelectedAnnot(ids[0] ?? null)
    setExtraSel(new Set(ids.slice(1)))
  }
  /** A preset arms its tool with its style. */
  const applyPreset = (p: ToolPreset) => {
    const k = p.kind as AnnotKind
    if (p.style.color) setColors((m) => ({ ...m, [k]: p.style.color! }))
    setFills((m) => ({ ...m, [k]: p.style.fill }))
    setDashes((m) => ({ ...m, [k]: p.style.dash }))
    setStyleMap((m) => ({
      ...m,
      [k]: { ...m[k], lineWidth: p.style.lineWidth, opacity: p.style.opacity, fontFamily: p.style.fontFamily, fontSize: p.style.fontSize, lineStart: p.style.lineStart, lineEnd: p.style.lineEnd, cloud: p.style.cloud, blend: p.style.blend }
    }))
    setSelectedAnnot(null)
    if (!isMarkup(k)) setTool(k as Tool)
    else setLastMarkup(k)
  }

  const save = useCallback(
    async (asNew: boolean, opts?: SaveAsChoice) => {
      if (saving) return
      if (locked) {
        setNotice({ kind: 'error', text: 'The owner of this document does not allow changes, so nothing was written. Enter the owner password to unlock it.' })
        return
      }
      if (annotsDirty && validSigsRef.current > 0 && !(await askBreak())) return
      setSaving(true)
      try {
        let out = annotsDirty ? await applyEdits(bytes) : bytes
        const before = out.length
        if (opts?.optimise) out = (await optimise(out, { maxDpi: 150, quality: 0.75, dropThumbnails: true, objectStreams: true, recompress: true, removeUnusedResources: true, linearise: false })).bytes
        const toWrite = await protect(out)
        const saved =
          !asNew && path
            ? await window.openpdf.saveFile(path, toWrite)
            : await window.openpdf.saveFileAs(name.replace(/(\.pdf)?$/i, '.pdf'), toWrite)
        if (!saved) return // the Save As dialog was cancelled
        if (opts?.copy) {
          // A copy: this document, its pending edits and its name stay as they were.
          setNotice({ kind: 'info', text: `Saved a copy as ${saved.name}${opts.optimise ? ` (${formatSize(before)} to ${formatSize(out.length)})` : ''}` })
          return
        }
        onMeta({ name: saved.name, path: saved.path })
        baseline.current = new Map() // the reloaded document is re-imported with fresh positions
        history.reset([])
        setZDirty(false)
        setProtectionDirty(false)
        setScaleDirty(false)
        setFormValues(new Map())
        setExtraSel(new Set())
        setSelectedAnnot(null)
        setEditingAnnot(null)
        setSavedBytes(out)
        setBytes(out)
        setNotice({ kind: 'info', text: `Saved ${saved.name}${opts?.optimise ? ` (${formatSize(before)} to ${formatSize(out.length)})` : ''}` })
      } catch (e) {
        setNotice({ kind: 'error', text: `Could not save:${e instanceof Error ? e.message : String(e)}` })
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
    setScaleDirty(false)
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
    async (kind: 'note' | 'textbox' | 'stamp' | 'caret' | 'typewriter' | 'fileattach' | 'sound' | 'addimage', page: number, x: number, y: number, box?: { w: number; h: number }) => {
      if (kind !== 'addimage') return place(kind, page, x, y, box)
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
        case 'insert':
          setPageDialog({ kind: 'insert', selection, insertAfter: op.at })
          return
        case 'extract':
          setPageDialog({ kind: 'extract', selection })
          return
        case 'split':
          setPageDialog({ kind: 'split', selection })
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
          setPageDialog({ kind: 'duplicate', selection })
          return
        case 'replace':
          setPageDialog({ kind: 'replace', selection })
          return
      }
    },
    [pages.length, applyPageEdit, annotsDirty, formValues, zDirty, bytes, name] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** What the open page dialog works from. */
  const dialogCtx: DocContext = { count: pages.length, current: Math.min(currentPage, Math.max(0, pages.length - 1)), selected: pageDialog?.selection ?? [], sizes: pages }

  const submitPageDialog = async (r: PageDialogResult) => {
    setPageDialog(null)
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    try {
      if (r.kind === 'extract' || r.kind === 'split') {
        const src = annotsDirty ? await applyEdits(bytes) : bytes
        if (r.kind === 'split') {
          const res = await window.openpdf.saveMany(await buildSplitFiles(r, src, baseName), r.dir)
          if (res) setNotice({ kind: 'info', text: `Wrote ${res.written.length} files to ${res.dir}` })
          return
        }
        if (r.each) {
          const res = await window.openpdf.saveMany(await buildExtractFiles(src, r.pages, r.each.pattern, baseName), r.each.dir)
          if (!res) return
          setNotice({ kind: 'info', text: `Wrote ${res.written.length} files to ${res.dir}` })
        } else {
          const out = await extractPages(src, r.pages)
          const saved = await window.openpdf.saveFileAs(`${baseName} (extract).pdf`, out)
          if (!saved) return
          setNotice({ kind: 'info', text: `Extracted ${plural(r.pages.length, 'page')} to ${saved.name}` })
          if (r.openAfter) onNewDoc(saved.name, out)
        }
        if (r.deleteAfter) await applyPageEdit((b) => deletePages(b, r.pages), `Extracted ${plural(r.pages.length, 'page')} and removed them from this document`)
        return
      }
      if (r.kind === 'merge' && !r.includeThis) {
        onNewDoc('Merged.pdf', (await mergeDocuments(r.items)).bytes)
        setNotice({ kind: 'info', text: `Merged ${plural(r.count, 'page')} into a new document` })
        return
      }
      await applyPageEdit((b) => applyDialogEdit(r, b), doneMessage(r))
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Opens a Pages-tab dialog on the thumbnail selection (or the current page when nothing is selected). */
  const openPageDialog = (kind: PageDialogKind) => setPageDialog({ kind, selection: pageSel, insertAfter: Math.max(...opPages) + 1 })

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
  const exportStructure = async (only: number[], plainLines = false): Promise<ExportBlock[][]> => {
    if (!client) return []
    const raw: Awaited<ReturnType<typeof groupBlocks>>[] = []
    for (const p of only) {
      const t = await client.textObjects(p)
      raw.push(groupBlocks(t.objects, t.rotation))
    }
    const body = bodySize(raw)
    const out: ExportBlock[][] = []
    for (let i = 0; i < only.length; i++) {
      const p = only[i]
      const blocks = plainLines ? [] : structurePage(raw[i], body)
      if (blocks.length) out.push(blocks)
      else {
        const plain = normaliseNewlines((await client.pageText(p)).text)
        out.push(plain.split(/\n+/).filter((l) => l.trim()).map((l) => ({ text: l.trim(), heading: 0 as const, size: body, bold: false, italic: false })))
      }
    }
    return out
  }
  const exportAs = async (kind: 'txt' | 'html' | 'docx', only: number[] = pages.map((_, i) => i), keepLayout = kind === 'txt') => {
    if (!client) return
    setBusy(true)
    try {
      let data: Uint8Array
      if (kind === 'txt') {
        const all: string[] = []
        for (const p of only) {
          const text = normaliseNewlines((await client.pageText(p)).text)
          // Without the page's line breaks, lines of a paragraph are joined and blank lines still separate paragraphs.
          all.push(keepLayout ? text : text.split(/\n{2,}/).map((para) => para.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n\n'))
        }
        data = new TextEncoder().encode(all.join('\n\f\n'))
      } else {
        const structure = await exportStructure(only, kind === 'html' && keepLayout)
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
  const summariseComments = async (filter?: CommentFilter) => {
    try {
      const out = await commentSummaryPdf(filter ? applyFilter(annots, filter) : annots, pageLabels, name)
      const saved = await window.openpdf.saveFileAs(`${baseName} (comment summary).pdf`, out)
      if (saved) setNotice({ kind: 'info', text: `Comment summary saved as ${saved.name}` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not summarise the comments: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  /** Comments out as XFDF or FDF, in PDF page coordinates. */
  const exportComments = async (format: 'xfdf' | 'fdf', filter?: CommentFilter) => {
    try {
      const chosen = filter ? applyFilter(commentAnnots, filter) : commentAnnots
      const norms = toNorms(chosen, await pageFrames(bytes))
      const data = format === 'xfdf' ? new TextEncoder().encode(toXfdf(norms, name)) : toFdf(norms, name)
      const saved = await window.openpdf.saveData(`${baseName}.${format}`, data, { name: format === 'xfdf' ? 'XFDF comments' : 'FDF comments', ext: format })
      if (saved) setNotice({ kind: 'info', text: `Exported ${chosen.length} comment${chosen.length === 1 ? '' : 's'} to ${saved}` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not export the comments: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  /** Comments in from an XFDF or FDF file: added as new annotations (undo removes them). */
  const importComments = async (opts: { replace: boolean; filter: CommentFilter } = { replace: false, filter: { by: 'all', pages: [], kinds: [], authors: [] } }) => {
    const file = await window.openpdf.pickFile({ name: 'Comment files (XFDF, FDF)', ext: ['xfdf', 'fdf', 'xml'] })
    if (!file) return
    try {
      const head = new TextDecoder('latin1').decode(file.data.subarray(0, 8))
      const norms = head.startsWith('%FDF-') ? await fromFdf(file.data) : fromXfdf(new TextDecoder().decode(file.data))
      const { annots: made, skipped } = fromNorms(norms, await pageFrames(bytes), () => nextAnnotId.current++)
      const usable = applyFilter(
        made.filter((a) => a.page < pages.length),
        opts.filter
      )
      // Replacing removes the existing comments (not links or other tools' annotations); undo brings them back.
      history.commit((list) => [...(opts.replace ? list.filter((a) => a.kind === 'link' || a.kind === 'foreign') : list), ...usable])
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

  const exportCommentsCsv = async (filter?: CommentFilter) => {
    const saved = await window.openpdf.saveText(`${baseName} (comments).csv`, commentsCsv(filter ? applyFilter(annots, filter) : annots, pageLabels), { name: 'CSV (comma separated)', ext: 'csv' })
    if (saved) setNotice({ kind: 'info', text: `Comments exported to ${saved}` })
  }

  // ---- Measurement ----------------------------------------------------------------------------------
  // Measurements are saved as measurement annotations. The scale comes from calibration, the page's own
  // viewport measure dictionaries, or paper millimetres.
  const measurements = useMemo(() => annots.filter((a) => a.measure), [annots])
  /** A scale for the whole document (calibrated, or set for every page in the Scale dialog). */
  const [calibrated, setCalibrated] = useState<Scale | null>(null)
  /** Scales set for particular pages in the Scale dialog; they win over the document scale. */
  const [pageScales, setPageScales] = useState<Record<number, Scale>>({})
  const [scaleDialog, setScaleDialog] = useState(false)
  const [scalePresets, setScalePresets] = useState<ScalePreset[]>([])
  useEffect(() => {
    void window.openpdf.getSettings().then((st) => setScalePresets(st.scalePresets ?? []))
  }, [])
  const changeScalePresets = (next: ScalePreset[]) => {
    setScalePresets(next)
    void window.openpdf.setSettings({ scalePresets: next }).then((st) => setScalePresets(st.scalePresets))
  }
  const [snapOn, setSnapOn] = useState(true)
  const [snapKinds, setSnapKinds] = useState<SnapKinds>(ALL_SNAPS)
  const [countLabel, setCountLabel] = useState('Count')
  const [viewports, setViewports] = useState<Viewport[][]>([])
  const [calibrating, setCalibrating] = useState<{ lengthPt: number; real: string; unit: string } | null>(null)
  const viewportsRef = useRef(viewports)
  viewportsRef.current = viewports
  const calibratedRef = useRef(calibrated)
  calibratedRef.current = calibrated
  const pageScalesRef = useRef(pageScales)
  pageScalesRef.current = pageScales
  const scaleDirtyRef = useRef(scaleDirty)
  scaleDirtyRef.current = scaleDirty
  const countLabelRef = useRef(countLabel)
  countLabelRef.current = countLabel
  /** The scale the person set for a page (its own, else the document's), or null when it is the file's own. */
  const userScaleFor = (page: number): Scale | null => pageScalesRef.current[page] ?? calibratedRef.current
  useEffect(() => {
    let cancelled = false
    readViewports(bytes).then((v) => !cancelled && setViewports(v))
    return () => {
      cancelled = true
    }
  }, [bytes])
  const measureScale = useCallback((page: number, at: Pt) => scaleAt(at, viewports[page], pageScales[page] ?? calibrated), [viewports, calibrated, pageScales])
  const measureLabel = useCallback(
    (kind: MeasureKind, points: Pt[], page: number) => {
      const s = measureScale(page, points[0])
      if (kind === 'area') return formatArea(polygonArea(points), s)
      return formatLength(pathLength(points), s)
    },
    [measureScale]
  )
  const onMeasure = useCallback((kind: MeasureKind | 'calibrate' | 'count', page: number, points: Pt[]) => {
    if (kind === 'calibrate') {
      setCalibrating({ lengthPt: pathLength(points), real: '', unit: 'm' })
      return
    }
    if (kind === 'count') {
      // A numbered marker: a small filled circle, numbered within its label.
      const group = countLabelRef.current.trim() || 'Count'
      const at = points[0]
      const marker: Annot = {
        ...newAnnot('ellipse', page, [{ x: at.x - 7, y: at.y - 7, w: 14, h: 14 }], ''),
        color: MEASURE_COLOR,
        fill: MEASURE_COLOR,
        lineWidth: 1,
        measure: { kind: 'count', factor: 1, unit: '', label: group, n: nextCount(annotsRef.current, group) }
      }
      history.commit((list) => [...list, marker])
      return
    }
    const s = scaleAt(points[0], viewportsRef.current[page], pageScalesRef.current[page] ?? calibratedRef.current)
    const label = resultLabel(kind, points, s)
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
  const activeScale = pageScales[currentPage] ?? calibrated
  const scaleText = activeScale
    ? activeScale.source === 'calibrated'
      ? `Calibrated: ${activeScale.label}`
      : `Scale: ${activeScale.label} (${activeScale.unit})`
    : viewports[currentPage]?.length
      ? `From the document${viewports[currentPage][0].scale.label ? `: ${viewports[currentPage][0].scale.label}` : ''} (${viewports[currentPage][0].scale.unit})`
      : 'Paper size (mm)'
  /** Sets the scale for `pages` (every page when it covers the document) and, if asked, re-measures what is already there. */
  const applyScale = (scale: Scale, pageList: number[], updateExisting: boolean) => {
    if (pageList.length >= pages.length) {
      setCalibrated(scale)
      setPageScales({})
    } else setPageScales((prev) => Object.fromEntries([...Object.entries(prev), ...pageList.map((p) => [p, scale] as const)]))
    setScaleDirty(true)
    setScaleDialog(false)
    if (updateExisting) {
      const on = new Set(pageList)
      annotsRef.current.filter((a) => a.measure && a.measure.kind !== 'count' && on.has(a.page) && a.points?.[0]).forEach((a) => touch(a.id))
      history.commit((list) =>
        list.map((a) => {
          if (!a.measure || a.measure.kind === 'count' || !on.has(a.page) || !a.points?.[0]) return a
          return { ...a, measure: { ...a.measure, factor: scale.factor, unit: scale.unit, ratio: scale.label, label: resultLabel(a.measure.kind, a.points[0], scale) } }
        })
      )
    }
    setNotice({ kind: 'info', text: `Scale ${scale.label ?? ''} set for ${pageList.length >= pages.length ? 'the whole document' : pageList.length === 1 ? `page ${pageList[0] + 1}` : `${pageList.length} pages`}` })
  }
  const measureList = useMemo(() => measureRows(measurements, pageLabels), [measurements, pageLabels])
  const labelMeasure = useCallback(
    (id: number, text: string) => {
      touch(id)
      history.commit((list) =>
        list.map((a) => (a.id === id && a.measure ? { ...a, measure: a.measure.kind === 'count' ? { ...a.measure, label: text.trim() || 'Count' } : { ...a.measure, name: text.trim() || undefined } } : a))
      )
    },
    [history.commit, touch]
  )
  const exportMeasurementsCsv = async () => {
    const saved = await window.openpdf.saveText(`${baseName} (measurements).csv`, measureCsv(measureList), { name: 'CSV (comma separated)', ext: 'csv' })
    if (saved) setNotice({ kind: 'info', text: `Measurements exported to ${saved}` })
  }
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
  const [printDialog, setPrintDialog] = useState<{ viewRange: [number, number] | null } | null>(null)
  const [printing, setPrinting] = useState<{ done: number; total: number; ctrl: AbortController } | null>(null)
  const openPrint = useCallback(() => {
    if (!pages.length || printing || permissions?.print === 'none') return
    // The pages showing in the view now: those whose box overlaps the scrolling area.
    let viewRange: [number, number] | null = null
    const scroller = [...document.querySelectorAll<HTMLElement>('.scroller')].find((el) => el.offsetParent !== null) // the shown tab's
    const area = scroller?.getBoundingClientRect()
    if (scroller && area) {
      const seen: number[] = []
      scroller.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.bottom > area.top && r.top < area.bottom && r.right > area.left && r.left < area.right) seen.push(Number(el.dataset.page))
      })
      if (seen.length) viewRange = [Math.min(...seen), Math.max(...seen)]
    }
    setPrintDialog((d) => d ?? { viewRange })
  }, [pages.length, printing, permissions])

  /** The document as it prints: pending annotation edits written into a copy (so the printout matches what Save would write), and layers hidden in the view hidden on paper too. */
  const preparePrint = async () => {
    let src = bytes
    if (annotsDirty && !locked) src = await applyEdits(bytes)
    if (hiddenLayers) src = await withHiddenLayers(src, hiddenLayers)
    return src
  }

  const runPrint = async (job: PrintJob) => {
    const list = job.options.pages
    setPrintDialog(null)
    const ctrl = new AbortController()
    setPrinting({ done: 0, total: list.length, ctrl })
    try {
      // PDFium draws everything, including annotations, at print resolution.
      const res = await printDocument(
        job.bytes,
        undefined,
        job.options,
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
        if (e.shiftKey) setCmdDialog({ kind: 'saveas' })
        else void save(false)
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
      <RGroup label={t('Properties')}>
        <RB big icon={SlidersHorizontal} label={t('Properties')} onClick={() => setPropsOpen((o) => !o)} pressed={propsOpen} title={t('Properties of the selection, or of the current tool (Ctrl+E)')} />
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
      <RGroup label={t('Edit')}>
        <RB big icon={Trash2} label={t('Delete')} onClick={() => selected && removeAnnot(selected.id)} disabled={!selected} title={t('Delete the selected annotation (Delete)')} />
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
              {t(label)}
            </button>
          ))}
        </div>
        <fieldset className="ribbon-body" role="tabpanel" disabled={locked && ribbon !== 'file' && ribbon !== 'home' && ribbon !== 'view'} aria-label={t(RIBBON_TABS.find(([k]) => k === ribbon)?.[1] ?? '')}>
          {ribbon === 'file' && (
            <>
              <RGroup label={t('Document')}>
                <RB big icon={FolderOpen} label={t('Open')} onClick={onOpen} title={t('Open a PDF (Ctrl+O)')} />
                <RB big icon={Save} label={t('Save')} badge={dirty} onClick={() => void save(false)} disabled={saving || !pages.length} title={dirty ? 'Save (Ctrl+S). There are unsaved changes' : 'Save (Ctrl+S)'} />
                <RB big icon={SaveAll} label={t('Save as')} onClick={() => setCmdDialog({ kind: 'saveas' })} disabled={saving || !pages.length} title={t('Save a copy (Ctrl+Shift+S)')} />
                <RB big icon={Combine} label={t('Combine files')} onClick={() => setCombineOpen(true)} title={t('Combine PDFs, pictures and Office files into one PDF')} />
                <RB big icon={X} label={t('Close')} onClick={onCloseDoc} title={t('Close this document (Ctrl+W)')} />
              </RGroup>
              <RGroup label={t('Comments')}>
                <RB big icon={FileInput} label={t('Import')} onClick={() => setCmdDialog({ kind: 'comments', mode: 'import', format: 'xfdf' })} disabled={!pages.length} title={t('Import comments from an XFDF or FDF file')} />
                <RStack>
                  <RB icon={FileOutput} label={t('Export XFDF')} onClick={() => setCmdDialog({ kind: 'comments', mode: 'export', format: 'xfdf' })} disabled={!commentAnnots.length} title={t('Export the comments as XFDF (XML)')} />
                  <RB icon={GitCompare} label={t('Compare…')} onClick={() => void compareWith()} disabled={!pages.length} title={t('Compare the comments with another copy of this document')} />
                  <RB icon={FileOutput} label={t('Export FDF')} onClick={() => setCmdDialog({ kind: 'comments', mode: 'export', format: 'fdf' })} disabled={!commentAnnots.length} title={t('Export the comments as FDF')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Automate')}>
                <RB big icon={Puzzle} label={t('Plugins')} onClick={() => setPluginsOpen(true)} title={t('Install and run plugins: small sandboxed scripts that make changes you choose')} />
                <RB big icon={ListChecks} label={t('Batch')} onClick={() => setBatchOpen(true)} title={t('Run a list of steps (watermark, page numbers, optimise, OCR, clean-up) over many PDFs')} />
              </RGroup>
              <RGroup label={t('Security')}>
                <RB big icon={ShieldCheck} label={t('Security')} onClick={() => setSecurityOpen(true)} disabled={!pages.length || busy || locked} title={t('Set or remove passwords and permissions (applied when you save)')} />
              </RGroup>
              <RGroup label={t('Info')}>
                <RB big icon={FileText} label={t('Properties')} onClick={() => void openDocProps()} disabled={!pages.length || busy || locked} title={t('Title, author, keywords and other document properties')} />
                <RB big icon={BadgeCheck} label={t('Standards')} onClick={() => void openStandards()} disabled={!pages.length || busy} title={t('What the file declares about PDF/A and PDF/UA, with basic checks')} />
                <RB big icon={Archive} label={t('Convert to PDF/A')} onClick={() => void makePdfA()} disabled={!pages.length || busy || locked} title={t('Make the file PDF/A-2b as far as this program can (best effort: check the result with a validator)')} />
              </RGroup>
              <RGroup label={t('Output')}>
                <RB big icon={Printer} label={t('Print')} onClick={openPrint} disabled={!pages.length || !!printing || permissions?.print === 'none'} title={permissions?.print === 'none' ? 'The owner of this document does not allow printing' : 'Print (Ctrl+P)'} />
              </RGroup>
            </>
          )}
          {ribbon === 'home' && (
            <>
              <RGroup label={t('Tools')}>
                <RB big icon={MousePointer2} label={t('Select')} onClick={() => setTool('select')} disabled={!pages.length} pressed={tool === 'select'} title={t('Select text and annotations')} />
                <RB big icon={Hand} label={t('Hand')} onClick={() => setTool('hand')} disabled={!pages.length} pressed={tool === 'hand'} title={t('Hand tool: drag to pan')} />
                <RB big icon={Camera} label={t('Snapshot')} onClick={() => setTool(tool === 'snapshot' ? 'select' : 'snapshot')} disabled={!pages.length} pressed={tool === 'snapshot'} title={t('Snapshot: drag a box to copy that area as an image')} />
                <RB big icon={ScanSearch} label={t('Zoom')} onClick={() => setTool(tool === 'zoom' ? 'select' : 'zoom')} disabled={!pages.length} pressed={tool === 'zoom'} title={t('Zoom tool: drag a box to fit it, click to zoom in, Shift+click to zoom out')} />
              </RGroup>
              <RGroup label={t('Edit')}>
                <RStack>
                  <RB icon={Copy} label={t('Copy')} onClick={() => void viewer.current?.copySelection()} disabled={!hasTextSelection || permissions?.extract === false} title={t('Copy the selected text (Ctrl+C)')} />
                  {undoButtons}
                </RStack>
              </RGroup>
              <RGroup label={t('Comment')}>
                <RB big icon={Highlighter} label={t('Highlight')} onClick={() => void markSelection('highlight')} disabled={!hasTextSelection || locked} title={t('Highlight the selected text')} />
                <RB big icon={StickyNote} label={t('Note')} onClick={() => setTool(tool === 'note' ? 'select' : 'note')} disabled={!pages.length || locked} pressed={tool === 'note'} title={t('Add a sticky note: click on the page')} />
              </RGroup>
              <RGroup label={t('Find')}>
                <RB big icon={Search} label={t('Find')} onClick={openSearch} disabled={!pages.length} pressed={searchOpen} title={t('Find (Ctrl+F)')} />
              </RGroup>
              <RGroup label={t('Document')}>
                <RB big icon={Save} label={t('Save')} badge={dirty} onClick={() => void save(false)} disabled={saving || !pages.length} title={dirty ? 'Save (Ctrl+S). There are unsaved changes' : 'Save (Ctrl+S)'} />
                <RB big icon={Printer} label={t('Print')} onClick={openPrint} disabled={!pages.length || !!printing || permissions?.print === 'none'} title={permissions?.print === 'none' ? 'The owner of this document does not allow printing' : 'Print (Ctrl+P)'} />
              </RGroup>
            </>
          )}
          {ribbon === 'comment' && (
            <>
              <RGroup label={t('Text markup')}>
                <RB big icon={Highlighter} label={t('Highlight')} onClick={() => void markSelection('highlight')} disabled={!hasTextSelection} title={t('Highlight the selected text')} />
                <RStack>
                  <RB icon={Underline} label={t('Underline')} onClick={() => void markSelection('underline')} disabled={!hasTextSelection} title={t('Underline the selected text')} />
                  <RB icon={Strikethrough} label={t('Strikeout')} onClick={() => void markSelection('strikeout')} disabled={!hasTextSelection} title={t('Strike out the selected text')} />
                  <RB icon={Waves} label={t('Squiggly')} onClick={() => void markSelection('squiggly')} disabled={!hasTextSelection} title={t('Squiggly underline under the selected text')} />
                </RStack>
                <RStack>
                  <RB icon={Replace} label={t('Replace text')} onClick={() => void markSelection('strikeout', true)} disabled={!hasTextSelection} title={t('Strike out the selected text and type its replacement')} />
                  <RB icon={TextCursorInput} label={t('Insert text')} onClick={() => setTool(tool === 'caret' ? 'select' : 'caret')} disabled={!pages.length} pressed={tool === 'caret'} title={t('Mark where text should be inserted: click in the text, then type it')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Notes')}>
                <RB big icon={StickyNote} label={t('Note')} onClick={() => setTool(tool === 'note' ? 'select' : 'note')} disabled={!pages.length} pressed={tool === 'note'} title={t('Add a sticky note: click on the page')} />
                <RB big icon={Type} label={t('Text box')} onClick={() => setTool(tool === 'textbox' ? 'select' : 'textbox')} disabled={!pages.length} pressed={tool === 'textbox'} title={t('Add a text box: click on the page')} />
                <RStack>
                  <RB icon={Keyboard} label={t('Typewriter')} onClick={() => setTool(tool === 'typewriter' ? 'select' : 'typewriter')} disabled={!pages.length} pressed={tool === 'typewriter'} title={t('Type straight onto the page: click where the text starts')} />
                  <RB icon={Paperclip} label={t('Attach file')} onClick={() => setTool(tool === 'fileattach' ? 'select' : 'fileattach')} disabled={!pages.length} pressed={tool === 'fileattach'} title={t('Attach a file: click on the page, then choose the file')} />
                  <RB icon={Volume2} label={t('Sound')} onClick={() => setTool(tool === 'sound' ? 'select' : 'sound')} disabled={!pages.length} pressed={tool === 'sound'} title={t('Attach a sound: click on the page, then choose a WAV recording')} />
                </RStack>
                <RStack>
                  <RB icon={Link2} label={t('Link')} onClick={() => setTool(tool === 'link' ? 'select' : 'link')} disabled={!pages.length} pressed={tool === 'link'} title={t('Add a link: drag a box, then choose a web address or a page')} />
                  <RB icon={MessageSquareShare} label={t('Callout')} onClick={() => setTool(tool === 'callout' ? 'select' : 'callout')} disabled={!pages.length} pressed={tool === 'callout'} title={t('Callout: drag from the point to call out to where the text box goes')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Stamp')}>
                <RB big icon={StampIcon} label={t('Stamp')} onClick={() => setTool(tool === 'stamp' ? 'select' : 'stamp')} disabled={!pages.length} pressed={tool === 'stamp'} title={t('Place a stamp: click on the page')} />
                <div className="menu-anchor stamp-anchor">
                  <button className="stamp-current" onClick={() => stamps.setOpen((o) => !o)} aria-expanded={stamps.open} aria-label="Choose stamp" title="Choose a stamp">
                    {stamps.choice.kind === 'image' ? <img src={stamps.choice.image?.dataUrl} alt="" /> : <span>{stamps.choice.title}</span>}
                    <ChevronDown size={14} aria-hidden />
                  </button>
                  {stamps.open && (
                    <StampPicker
                      choice={stamps.choice}
                      dated={stamps.dated}
                      stamps={stamps.stamps}
                      recent={stamps.meta.recent}
                      counters={stamps.meta.counters}
                      author={author}
                      opts={stamps.opts}
                      onOpts={stamps.setOpts}
                      onPick={stamps.pick}
                      onDated={stamps.setDated}
                      onNew={stamps.newStamp}
                      onEdit={stamps.edit}
                      onDelete={(s) => void stamps.remove(s)}
                      onPages={stamps.arm}
                      onImport={() => void stamps.importCollection()}
                      onExport={() => void stamps.exportCollection()}
                      onClose={() => stamps.setOpen(false)}
                    />
                  )}
                </div>
                <RB icon={CopyPlus} label={t('To pages…')} onClick={stamps.copySelected} disabled={selected?.kind !== 'stamp'} title={t('Copy the selected stamp to other pages, in the same place')} />
              </RGroup>
              {styleAndEdit}
            </>
          )}
          {ribbon === 'draw' && (
            <>
              <RGroup label={t('Drawing')}>
                <RStack>
                  <RB icon={Slash} label={t('Line')} onClick={() => setTool(tool === 'line' ? 'select' : 'line')} disabled={!pages.length} pressed={tool === 'line'} title={t('Draw a line: drag. Hold Shift for 45 degree steps')} />
                  <RB icon={MoveUpRight} label={t('Arrow')} onClick={() => setTool(tool === 'arrow' ? 'select' : 'arrow')} disabled={!pages.length} pressed={tool === 'arrow'} title={t('Draw an arrow: drag. Hold Shift for 45 degree steps')} />
                </RStack>
                <RStack>
                  <RB icon={Hexagon} label={t('Polygon')} onClick={() => setTool(tool === 'polygon' ? 'select' : 'polygon')} disabled={!pages.length} pressed={tool === 'polygon'} title={t('Polygon: click the corners, double-click or Enter to finish')} />
                </RStack>
                <RStack>
                  <RB icon={Square} label={t('Rectangle')} onClick={() => setTool(tool === 'rectangle' ? 'select' : 'rectangle')} disabled={!pages.length} pressed={tool === 'rectangle'} title={t('Draw a rectangle: drag. Hold Shift for a square')} />
                  <RB icon={Circle} label={t('Ellipse')} onClick={() => setTool(tool === 'ellipse' ? 'select' : 'ellipse')} disabled={!pages.length} pressed={tool === 'ellipse'} title={t('Draw an ellipse: drag. Hold Shift for a circle')} />
                  <RB icon={Spline} label={t('Polyline')} onClick={() => setTool(tool === 'polyline' ? 'select' : 'polyline')} disabled={!pages.length} pressed={tool === 'polyline'} title={t('Polyline: click the points, double-click or Enter to finish')} />
                </RStack>
                <RB big icon={Cloud} label={t('Cloud')} onClick={() => setTool(tool === 'cloud' ? 'select' : 'cloud')} disabled={!pages.length} pressed={tool === 'cloud'} title={t('Revision cloud: click the corners, double-click or Enter to finish')} />
                <RB big icon={EraserIcon} label={t('Eraser')} onClick={() => setTool(tool === 'eraser' ? 'select' : 'eraser')} disabled={!pages.length} pressed={tool === 'eraser'} title={t('Eraser: drag over pencil strokes to rub them out')} />
                <RB big icon={Pencil} label={t('Pencil')} onClick={() => setTool(tool === 'ink' ? 'select' : 'ink')} disabled={!pages.length} pressed={tool === 'ink'} title={t('Draw freehand: drag')} />
              </RGroup>
              {styleAndEdit}
            </>
          )}
          {ribbon === 'measure' && (
            <>
              <RGroup label={t('Measure')}>
                <RB big icon={Ruler} label={t('Distance')} onClick={() => setTool(tool === 'measure-distance' ? 'select' : 'measure-distance')} disabled={!pages.length} pressed={tool === 'measure-distance'} title={t('Measure a distance: click two points. Shift keeps 45 degree steps')} />
                <RB big icon={Spline} label={t('Perimeter')} onClick={() => setTool(tool === 'measure-perimeter' ? 'select' : 'measure-perimeter')} disabled={!pages.length} pressed={tool === 'measure-perimeter'} title={t('Measure a path: click points, double-click or Enter to finish, Backspace to undo a point')} />
                <RB big icon={Pentagon} label={t('Area')} onClick={() => setTool(tool === 'measure-area' ? 'select' : 'measure-area')} disabled={!pages.length} pressed={tool === 'measure-area'} title={t('Measure an area: click the corners, double-click or Enter to finish')} />
                <RB big icon={Hash} label={t('Count')} onClick={() => setTool(tool === 'measure-count' ? 'select' : 'measure-count')} disabled={!pages.length} pressed={tool === 'measure-count'} title={t('Count: click to drop numbered markers, numbered within the label')} />
                <RStack>
                  <input className="rinput" aria-label={t('Count label')} value={countLabel} onChange={(e) => setCountLabel(e.target.value)} title={t('Label for the markers you drop: each label is numbered and totalled on its own')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Snap')}>
                <RB big icon={Magnet} label={t('Snap to content')} onClick={() => setSnapOn(!snapOn)} pressed={snapOn} disabled={!pages.length} title={t('Snap measuring points to the drawing\'s lines and corners. Hold Ctrl to snap to nothing while you click')} />
                <RStack>
                  <RB icon={Square} label={t('Endpoint')} onClick={() => setSnapKinds({ ...snapKinds, end: !snapKinds.end })} pressed={snapOn && snapKinds.end} disabled={!snapOn} title={t('Snap to the ends and corners of lines and shapes')} />
                  <RB icon={Triangle} label={t('Midpoint')} onClick={() => setSnapKinds({ ...snapKinds, mid: !snapKinds.mid })} pressed={snapOn && snapKinds.mid} disabled={!snapOn} title={t('Snap to the middle of a line')} />
                </RStack>
                <RStack>
                  <RB icon={X} label={t('Intersection')} onClick={() => setSnapKinds({ ...snapKinds, inter: !snapKinds.inter })} pressed={snapOn && snapKinds.inter} disabled={!snapOn} title={t('Snap to where two lines cross')} />
                  <RB icon={Diamond} label={t('Nearest')} onClick={() => setSnapKinds({ ...snapKinds, near: !snapKinds.near })} pressed={snapOn && snapKinds.near} disabled={!snapOn} title={t('Snap to the nearest point on a line')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Scale')}>
                <RB big icon={ScaleIcon} label={t('Scale…')} onClick={() => setScaleDialog(true)} disabled={!pages.length} title={t('Choose a drawing scale such as 1:100, the units and precision, and which pages it applies to')} />
                <RB big icon={Scaling} label={t('Calibrate')} onClick={() => setTool(tool === 'calibrate' ? 'select' : 'calibrate')} disabled={!pages.length} pressed={tool === 'calibrate'} title={t('Set the scale: click both ends of a line of known length, then enter its real length')} />
                <RStack>
                  <span className="rnote" title={scaleText}>
                    {scaleText}
                  </span>
                  <RB icon={RotateCcw} label={t('Use document scale')} onClick={() => { setCalibrated(null); setPageScales({}); setScaleDirty(false) }} disabled={!calibrated && !Object.keys(pageScales).length} title={t('Forget the calibration and use the document\'s scale (or paper size)')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Results')}>
                <RB big icon={Ruler} label={t('Measurements')} onClick={() => setSidebar(sidebar === 'measure' ? null : 'measure')} pressed={sidebar === 'measure'} title={t('List every measurement: go to it, label it, delete it, export it')} />
                <RB big icon={Download} label={t('Export CSV')} onClick={() => void exportMeasurementsCsv()} disabled={!measurements.length} title={t('Save every measurement as a CSV file')} />
                <RStack>
                  <RB icon={Copy} label={t('Copy all')} onClick={() => void copyMeasurements()} disabled={!measurements.length} title={t('Copy every measurement as text')} />
                  <RB icon={Trash2} label={t('Clear all')} onClick={() => history.commit((list) => list.filter((a) => !a.measure))} disabled={!measurements.length} title={t('Delete every measurement made in this session')} />
                </RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'organise' && (
            <>
              <RGroup label={pageSel.length > 1 ? `Pages (${pageSel.length} selected)` : `Page ${opPages[0] + 1}`}>
                <RStack>
                  <RB icon={RotateCcwSquare} label={t('Rotate left')} onClick={() => void runPageOp({ kind: 'rotate', delta: -90 }, opPages)} disabled={!pages.length || busy} title={t('Rotate the selected pages anticlockwise (changes the file)')} />
                  <RB icon={RotateCwSquare} label={t('Rotate right')} onClick={() => void runPageOp({ kind: 'rotate', delta: 90 }, opPages)} disabled={!pages.length || busy} title={t('Rotate the selected pages clockwise (changes the file)')} />
                  <RB icon={RotateCw} label={t('Rotate pages…')} onClick={() => openPageDialog('rotate')} disabled={!pages.length || busy} title={t('Rotate odd, even, landscape, portrait or chosen pages')} />
                </RStack>
                <RB big icon={Trash2} label={t('Delete')} onClick={() => openPageDialog('delete')} disabled={!pages.length || busy || pages.length < 2} title={t('Delete the selected pages')} />
                <RB big icon={ArrowUpDown} label={t('Move')} onClick={() => openPageDialog('move')} disabled={!pages.length || busy || pages.length < 2} title={t('Move pages to another place in the document')} />
              </RGroup>
              <RGroup label={t('Copy')}>
                <RStack>
                  <RB icon={Copy} label={t('Copy pages')} onClick={() => void runPageOp({ kind: 'copy' }, opPages)} disabled={!pages.length || busy} title={t('Copy the selected pages (Ctrl+C in the thumbnails)')} />
                  <RB icon={ClipboardPaste} label={t('Paste pages')} onClick={() => void runPageOp({ kind: 'paste', at: Math.max(...opPages) + 1 }, opPages)} disabled={!pages.length || busy || !hasPageClip} title={t('Paste copied pages after the selected pages (Ctrl+V in the thumbnails)')} />
                  <RB icon={CopyPlus} label={t('Duplicate')} onClick={() => openPageDialog('duplicate')} disabled={!pages.length || busy} title={t('Insert copies of the selected pages after them')} />
                </RStack>
                <RB big icon={Replace} label={t('Replace')} onClick={() => openPageDialog('replace')} disabled={!pages.length || busy} title={t('Replace the selected pages with pages from another PDF')} />
              </RGroup>
              <RGroup label={t('Insert and extract')}>
                <RB big icon={FilePlus2} label={t('Insert')} onClick={() => openPageDialog('insert')} disabled={!pages.length || busy} title={t('Insert pages from another PDF after the selected pages')} />
                <RB big icon={FileOutput} label={t('Extract')} onClick={() => openPageDialog('extract')} disabled={!pages.length || busy} title={t('Save the selected pages as a new PDF')} />
              </RGroup>
              <RGroup label={t('Documents')}>
                <RB big icon={Files} label={t('Merge')} onClick={() => openPageDialog('merge')} disabled={!pages.length || busy} title={t('Merge: add the pages of other PDFs to the end')} />
                <RB big icon={Combine} label={t('Combine files')} onClick={() => setCombineOpen(true)} title={t('Combine PDFs, pictures and Office files into one PDF')} />
                <RB big icon={Scissors} label={t('Split')} onClick={() => openPageDialog('split')} disabled={!pages.length || busy} title={t('Split into files of a set number of pages')} />
                <RB big icon={GitCompare} label={t('Compare')} onClick={() => setCompareOpen(true)} disabled={!pages.length || busy} title={t('Compare this document with another PDF: the words, and how the pages look')} />
              </RGroup>
              <RGroup label={t('Optimise')}>
                <RB big icon={Gauge} label={t('Optimise')} onClick={() => setOptimising(true)} disabled={!pages.length || busy || locked} title={t('Make the file smaller: reduce pictures, compress, remove unused objects, linearise')} />
              </RGroup>
              <RGroup label={t('Numbering')}>
                <RB big icon={Tags} label={t('Page labels')} onClick={() => void openPageLabels()} disabled={!pages.length || busy || locked} title={t('Set the page numbers readers show (i, ii, 1, 2 …)')} />
              </RGroup>
              <RGroup label={t('Edit')}>
                <RStack>{undoButtons}</RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'edit' && (
            <>
              <RGroup label={t('Text')}>
                <RB big icon={TextCursorInput} label={t('Edit text')} onClick={() => setTool(tool === 'edittext' ? 'select' : 'edittext')} pressed={tool === 'edittext'} disabled={!pages.length || busy || locked} title={t('Click a line of text to change it (the text is redrawn in a matching standard font)')} />
              </RGroup>
              <RGroup label={t('Align')}>
                <RStack>
                  <RB icon={AlignHorizontalJustifyStart} label={t('Left')} onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'left' as AlignMode))} disabled={selectedIds.size < 2} title={t('Align the selected annotations to their left edge (Shift-click to select several)')} />
                  <RB icon={AlignHorizontalJustifyCenter} label={t('Centre')} onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'centre'))} disabled={selectedIds.size < 2} title={t('Centre the selected annotations horizontally')} />
                  <RB icon={AlignHorizontalJustifyEnd} label={t('Right')} onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'right'))} disabled={selectedIds.size < 2} title={t('Align to the right edge')} />
                </RStack>
                <RStack>
                  <RB icon={AlignVerticalJustifyStart} label={t('Top')} onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'top'))} disabled={selectedIds.size < 2} title={t('Align to the top edge')} />
                  <RB icon={AlignVerticalJustifyCenter} label={t('Middle')} onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'middle'))} disabled={selectedIds.size < 2} title={t('Centre vertically')} />
                  <RB icon={AlignVerticalJustifyEnd} label={t('Bottom')} onClick={() => arrangeSelected((l, i) => alignAnnots(l, i, 'bottom'))} disabled={selectedIds.size < 2} title={t('Align to the bottom edge')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Distribute')}>
                <RStack>
                  <RB icon={AlignHorizontalDistributeCenter} label={t('Across')} onClick={() => arrangeSelected((l, i) => distributeAnnots(l, i, 'horizontal'))} disabled={selectedIds.size < 3} title={t('Space three or more selected annotations evenly across the page')} />
                  <RB icon={AlignVerticalDistributeCenter} label={t('Down')} onClick={() => arrangeSelected((l, i) => distributeAnnots(l, i, 'vertical'))} disabled={selectedIds.size < 3} title={t('Space three or more selected annotations evenly down the page')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Order')}>
                <RStack>
                  <RB icon={BringToFront} label={t('To front')} onClick={() => arrangeSelected((l, i) => restack(l, i, 'front' as StackMode), true)} disabled={!selectedIds.size} title={t('Draw the selected annotations on top of the others')} />
                  <RB icon={ArrowUp} label={t('Forward')} onClick={() => arrangeSelected((l, i) => restack(l, i, 'forward'), true)} disabled={!selectedIds.size} title={t('Move the selected annotations one step forward')} />
                </RStack>
                <RStack>
                  <RB icon={SendToBack} label={t('To back')} onClick={() => arrangeSelected((l, i) => restack(l, i, 'back'), true)} disabled={!selectedIds.size} title={t('Draw the selected annotations behind the others')} />
                  <RB icon={ArrowDown} label={t('Backward')} onClick={() => arrangeSelected((l, i) => restack(l, i, 'backward'), true)} disabled={!selectedIds.size} title={t('Move the selected annotations one step back')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Shapes')}>
                <RB big icon={Shapes} label={t('Edit shape')} onClick={() => setTool(tool === 'editpath' ? 'select' : 'editpath')} pressed={tool === 'editpath'} disabled={!pages.length || busy || locked} title={t('Click a line, box or filled shape that is part of the page to move, resize or delete it')} />
              </RGroup>
              <RGroup label={t('Images')}>
                <RB big icon={ImageIcon} label={t('Add image')} onClick={() => void startAddImage()} pressed={tool === 'addimage'} disabled={!pages.length || busy || locked} title={t('Choose a PNG or JPEG, then click the page to place it as page content')} />
                <RB big icon={ImageIcon} label={t('Edit image')} onClick={() => setTool(tool === 'editimage' ? 'select' : 'editimage')} pressed={tool === 'editimage'} disabled={!pages.length || busy || locked} title={t('Click a picture to move it, resize it, replace it or delete it')} />
              </RGroup>
              <RGroup label={t('Edit')}>
                <RStack>{undoButtons}</RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'forms' && (
            <>
              <RGroup label={formFields.length ? `Fill (${formFields.length} field${formFields.length === 1 ? '' : 's'})` : 'Fill'}>
                <RB big icon={Highlighter} label={t('Highlight fields')} onClick={() => setHighlightFields(!highlightFields)} pressed={highlightFields} disabled={!formFields.length} title={t('Tint form fields so they are easy to find')} />
                <RB big icon={Eraser} label={t('Clear form')} onClick={resetForm} disabled={!formFields.length || busy} title={t('Empty every field')} />
                <RB big icon={RotateCcw} label={t('Revert')} onClick={() => setFormValues(new Map())} disabled={!formValues.size} title={t('Go back to the values saved in the file')} />
              </RGroup>
              <RGroup label={t('Add a field')}>
                <RStack>
                  <RB icon={TextCursorInput} label={t('Text')} onClick={() => startField('text')} pressed={tool === 'formfield' && fieldKind === 'text'} disabled={!pages.length || busy || locked} title={t('Draw a text field on the page')} />
                  <RB icon={SquareCheck} label={t('Check box')} onClick={() => startField('checkbox')} pressed={tool === 'formfield' && fieldKind === 'checkbox'} disabled={!pages.length || busy || locked} title={t('Draw a check box')} />
                  <RB icon={CircleDot} label={t('Radio')} onClick={() => startField('radio')} pressed={tool === 'formfield' && fieldKind === 'radio'} disabled={!pages.length || busy || locked} title={t('Draw a radio button (buttons with the same group name are exclusive)')} />
                </RStack>
                <RStack>
                  <RB icon={SquareChevronDown} label={t('Drop-down')} onClick={() => startField('dropdown')} pressed={tool === 'formfield' && fieldKind === 'dropdown'} disabled={!pages.length || busy || locked} title={t('Draw a drop-down list')} />
                  <RB icon={List} label={t('List box')} onClick={() => startField('list')} pressed={tool === 'formfield' && fieldKind === 'list'} disabled={!pages.length || busy || locked} title={t('Draw a list box')} />
                  <RB icon={RectangleHorizontal} label={t('Button')} onClick={() => startField('button')} pressed={tool === 'formfield' && fieldKind === 'button'} disabled={!pages.length || busy || locked} title={t('Draw a push button')} />
                </RStack>
                <RB big icon={PenLine} label={t('Signature')} onClick={() => startField('signature')} pressed={tool === 'formfield' && fieldKind === 'signature'} disabled={!pages.length || busy || locked} title={t('Draw a signature field')} />
              </RGroup>
              <RGroup label={t('Find fields')}>
                <RB big icon={ScanSearch} label={t('Detect fields')} onClick={() => void detectFormFields()} disabled={!pages.length || busy || locked || !client} title={t('Find blanks, lines, boxes and squares on the pages and make them into fields')} />
              </RGroup>
              <RGroup label={t('Arrange fields')}>
                <RB big icon={SquareDashedMousePointer} label={t('Edit fields')} onClick={() => setTool(tool === 'formedit' ? 'select' : 'formedit')} pressed={tool === 'formedit'} disabled={!formFields.length || busy || locked} title={t('Select, move, resize, rename or delete fields')} />
                <RStack>
                  <RB icon={Rows3} label={t('Tab by rows')} onClick={() => chooseTabOrder('rows')} pressed={formFields[0]?.widgets[0]?.tabs === 'R'} disabled={!formFields.length || busy || locked} title={t('Tab moves along each row, then down')} />
                  <RB icon={Columns3} label={t('Tab by columns')} onClick={() => chooseTabOrder('columns')} pressed={formFields[0]?.widgets[0]?.tabs === 'C'} disabled={!formFields.length || busy || locked} title={t('Tab moves down each column, then across')} />
                  <RB icon={ListOrdered} label={t('Tab in field order')} onClick={() => chooseTabOrder('structure')} pressed={formFields[0]?.widgets[0]?.tabs === 'S'} disabled={!formFields.length || busy || locked} title={t('Tab follows the order of the fields on the page (use Earlier and Later to change it)')} />
                </RStack>
                <RStack>
                  <RB icon={ArrowUp} label={t('Earlier')} onClick={() => stepTabOrder(-1)} disabled={!designSel || tool !== 'formedit' || busy} title={t('Move the selected field earlier in the tab order')} />
                  <RB icon={ArrowDown} label={t('Later')} onClick={() => stepTabOrder(1)} disabled={!designSel || tool !== 'formedit' || busy} title={t('Move the selected field later in the tab order')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Form data')}>
                <RB big icon={FileInput} label={t('Import…')} onClick={() => void importFormData()} disabled={!formFields.length || busy} title={t('Fill the fields from an FDF, XFDF, CSV or XML file')} />
                <RStack>
                  <RB icon={FileOutput} label={t('XFDF')} onClick={() => void exportFormData('xfdf')} disabled={!formFields.length} title={t('Export the values as XFDF (XML)')} />
                  <RB icon={FileOutput} label={t('FDF')} onClick={() => void exportFormData('fdf')} disabled={!formFields.length} title={t('Export the values as FDF')} />
                </RStack>
                <RStack>
                  <RB icon={FileOutput} label={t('CSV')} onClick={() => void exportFormData('csv')} disabled={!formFields.length} title={t('Export the values as CSV (a row of names and a row of values)')} />
                  <RB icon={FileOutput} label={t('XML')} onClick={() => void exportFormData('xml')} disabled={!formFields.length} title={t('Export the values as XML')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Finish')}>
                <RB big icon={Layers2} label={t('Flatten')} onClick={() => setCmdDialog({ kind: 'flatten' })} disabled={(!formFields.length && !commentAnnots.length) || busy || locked} title={t('Make the fields part of the page so they can no longer be edited')} />
              </RGroup>
              {!formFields.length && <p className="muted ribbon-note">This document has no form fields.</p>}
            </>
          )}
          {ribbon === 'redact' && (
            <>
              <RGroup label={t('Mark')}>
                <RB big icon={EyeOff} label={t('Mark area')} onClick={() => setTool(tool === 'redact' ? 'select' : 'redact')} pressed={tool === 'redact'} disabled={!pages.length || busy || locked} title={t('Drag a box over what is to be removed')} />
                <RB big icon={TextSelect} label={t('Mark text')} onClick={() => void markSelectionForRedaction()} disabled={!pages.length || busy || locked} title={t('Mark the text you have selected')} />
                <RB big icon={Search} label={t('Mark search')} onClick={() => void markSearchForRedaction()} disabled={!pages.length || busy || locked} title={t('Mark every match of the current search (Ctrl+F to search)')} />
              </RGroup>
              <RGroup label={t('Apply')}>
                <RB big icon={ShieldAlert} label={t('Apply')} onClick={() => setRedactConfirm(true)} disabled={!redactMarks.length || busy || locked} title={t('Permanently remove what is under the marks')} />
                <RB big icon={X} label={t('Clear marks')} onClick={() => setRedactMarks([])} disabled={!redactMarks.length} title={t('Take all the marks off without removing anything')} />
              </RGroup>
              <RGroup label={t('Sanitise')}>
                <RB big icon={Eraser} label={t('Hidden information')} onClick={() => void openSanitise()} disabled={!pages.length || busy || locked} title={t('Find and remove metadata, attached files, scripts and other things that are not on the pages')} />
              </RGroup>
            </>
          )}
          {ribbon === 'convert' && (
            <>
            <RGroup label={t('Export')}>
              <RB big icon={ImageIcon} label={t('Pictures')} onClick={() => setExportImagesOpen(true)} disabled={!pages.length || busy} title={t('Save the pages as PNG, JPEG or TIFF pictures')} />
              <RB big icon={FileText} label={t('Text')} onClick={() => setCmdDialog({ kind: 'export', as: 'txt' })} disabled={!pages.length || busy} title={t('Save the text of the document as a plain text file')} />
              <RB big icon={Globe} label={t('HTML')} onClick={() => setCmdDialog({ kind: 'export', as: 'html' })} disabled={!pages.length || busy} title={t('Save the text as a web page, with headings and paragraphs (pictures and layout are not kept)')} />
              <RB big icon={FileOutput} label={t('Word')} onClick={() => setCmdDialog({ kind: 'export', as: 'docx' })} disabled={!pages.length || busy} title={t('Save the text as a Word document, with headings and paragraphs (best effort: pictures and layout are not kept)')} />
            </RGroup>
            <RGroup label={t('Recognise')}>
              <RB big icon={ScanText} label={t('OCR')} onClick={() => setOcrOpen(true)} disabled={!pages.length || busy || locked} title={t('Recognise the text in scanned pages so they can be searched and copied')} />
            </RGroup>
            <RGroup label={t('Scan')}>
              <RB big icon={ScanLine} label={t('Scan')} onClick={() => setScanOpen(true)} disabled={busy} title={t('Scan paper with a scanner connected to this computer')} />
            </RGroup>
            <RGroup label={t('Create PDF')}>
              <RB big icon={ImageIcon} label={t('From pictures')} onClick={() => void pickToCreate('images')} disabled={busy} title={t('Make a PDF from PNG, JPEG, GIF, BMP, WebP or TIFF pictures, one per page')} />
              <RB big icon={FileText} label={t('From text')} onClick={() => void pickToCreate('text')} disabled={busy} title={t('Make a PDF from a plain text file')} />
              <RB big icon={Globe} label={t('From web page')} onClick={() => void makeNew('Could not convert the web page', () => window.openpdf.htmlToPdf())} disabled={busy} title={t('Make a PDF from a saved .html file (scripts and network access are off)')} />
              <RB big icon={Paperclip} label={t('Portfolio')} onClick={() => void window.openpdf.pickFiles().then((f) => f.length && setPortfolioFiles(f))} disabled={busy} title={t('Package several files of any kind in one PDF portfolio')} />
              <RB big icon={FileInput} label={t('From Office file')} onClick={() => void makeNew('Could not convert the file', () => window.openpdf.officeToPdf())} disabled={busy} title={officeReady ? 'Make a PDF from a Word, Excel or PowerPoint file (uses LibreOffice)' : 'Needs LibreOffice, which is not installed'} />
              <RB big icon={ClipboardPaste} label={t('From clipboard')} onClick={() => void fromPicture('Could not create the PDF', () => window.openpdf.clipboardImage(), 'Clipboard.pdf', 'There is no picture on the clipboard.')} disabled={busy} title={t('Make a PDF from the picture on the clipboard')} />
              <RB big icon={Camera} label={t('Screenshot')} onClick={() => void fromPicture('Could not take the screenshot', () => window.openpdf.screenshot(), `Screenshot ${today()}.pdf`, 'The screen could not be captured.')} disabled={busy} title={t('Make a PDF from a picture of the whole screen')} />
            </RGroup>
            </>
          )}
          {ribbon === 'sign' && (
            <>
              <RGroup label={t('Signatures')}>
                <RB big icon={FileSignature} label={t('Sign document')} onClick={() => setSignOpen(true)} disabled={!pages.length || busy || locked} title={t('Sign with a certificate from Windows or a certificate file')} />
                <RB big icon={ShieldCheck} label={t('Signatures')} onClick={() => setSigPanel(true)} disabled={!pages.length} title={t('Check who signed this document and whether it has changed since')} />
              </RGroup>
              <RGroup label={t('Signature pictures')}>
                <RB big icon={PenLine} label={t('Add signature')} onClick={signatures.open} disabled={!pages.length} title={t('Draw, type or import a signature or initials, then place it on the page. This is a picture, not a certificate signature')} />
                <RStack>
                  <RB icon={FileSignature} label={t('Sign here')} onClick={() => signatures.placeholder('sign')} disabled={!pages.length} pressed={tool === 'stamp' && stamps.choice.id === 'builtin:sign-here'} title={t('Mark where someone should sign: click on the page')} />
                  <RB icon={PenLine} label={t('Initial here')} onClick={() => signatures.placeholder('initial')} disabled={!pages.length} pressed={tool === 'stamp' && stamps.choice.id === 'builtin:initial-here'} title={t('Mark where someone should initial: click on the page')} />
                  <RB icon={Layers2} label={t('Flatten signatures')} onClick={flattenPlacedSignatures} disabled={!pages.length || busy || locked} title={t('Make the placed signature pictures part of the pages so they can no longer be moved or deleted')} />
                </RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'layout' && (
            <>
              <RGroup label={t('Header and footer')}>
                <RB big icon={PanelTop} label="Header & footer" onClick={() => setMarksMode('headerfooter')} disabled={!pages.length || busy} title={t('Add a header and footer to pages')} />
                <RStack>
                  <RB icon={Hash} label={t('Page numbers')} onClick={() => setMarksMode('pagenumbers')} disabled={!pages.length || busy} title={t('Add page numbers')} />
                  <RB icon={Barcode} label={t('Bates numbers')} onClick={() => setMarksMode('bates')} disabled={!pages.length || busy} title={t('Add Bates numbers (prefix and running number)')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Watermark')}>
                <RB big icon={Droplets} label={t('Watermark')} onClick={() => setMarksMode('watermark')} disabled={!pages.length || busy} title={t('Add a text or picture watermark')} />
                <RB big icon={PaintBucket} label={t('Background')} onClick={() => setMarksMode('background')} disabled={!pages.length || busy} title={t('Add a background colour or picture behind the pages')} />
              </RGroup>
              <RGroup label={t('Page size')}>
                <RStack>
                  <RB icon={Crop} label={t('Crop…')} onClick={() => setMarksMode('crop')} disabled={!pages.length || busy} title={t('Crop pages by margins')} />
                  <RB icon={SquareDashed} label={t('Crop tool')} onClick={() => setTool(tool === 'crop' ? 'select' : 'crop')} pressed={tool === 'crop'} disabled={!pages.length || busy} title={t('Drag a box on a page to crop to it (the selected thumbnails get the same box)')} />
                  <RB icon={Maximize2} label={t('Resize…')} onClick={() => setMarksMode('resize')} disabled={!pages.length || busy} title={t('Change the paper size of pages')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Remove')}>
                <RB big icon={Eraser} label={t('Remove marks')} onClick={() => setMarksMode('remove')} disabled={!pages.length || busy || !presentMarks.size} title={t('Remove headers, footers, numbers, watermarks or backgrounds added with OpenPDF')} />
              </RGroup>
            </>
          )}
          {ribbon === 'view' && (
            <>
              <RGroup label={t('Panes')}>
                <RB big icon={LayoutGrid} label={t('Pages')} onClick={() => setSidebar(sidebar === 'pages' ? null : 'pages')} pressed={sidebar === 'pages'} title={t('Show or hide page thumbnails')} />
                <RB big icon={Bookmark} label={t('Bookmarks')} onClick={() => setSidebar(sidebar === 'bookmarks' ? null : 'bookmarks')} pressed={sidebar === 'bookmarks'} title={t('Show or hide bookmarks')} />
                <RStack>
                  <RB icon={PanelLeft} label={t('Dock left')} onClick={() => onPaneSide('left')} pressed={paneSide === 'left'} title={t('Dock the side pane on the left')} />
                  <RB icon={PanelRight} label={t('Dock right')} onClick={() => onPaneSide('right')} pressed={paneSide === 'right'} title={t('Dock the side pane on the right')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Page display')}>
                <RB big icon={FileText} label={t('Single')} onClick={() => setPageMode({ ...pageMode, twoUp: false })} pressed={!pageMode.twoUp} disabled={!pages.length} title={t('One page per row')} />
                <RB big icon={Columns2} label={t('Two pages')} onClick={() => setPageMode({ ...pageMode, twoUp: true })} pressed={pageMode.twoUp} disabled={!pages.length} title={t('Two pages side by side')} />
                <RStack>
                  <RB icon={GalleryVertical} label={t('Continuous')} onClick={() => setPageMode({ ...pageMode, continuous: !pageMode.continuous })} pressed={pageMode.continuous} disabled={!pages.length} title={t('Scroll through all pages, or show one page (or pair) at a time')} />
                  <RB icon={BookOpen} label={t('Cover page')} onClick={() => setPageMode({ ...pageMode, cover: !pageMode.cover })} pressed={pageMode.cover} disabled={!pages.length || !pageMode.twoUp} title={t('With two pages: show the first page on its own, like a book cover')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Zoom')}>
                <RB big icon={ScanSearch} label={t('Zoom tool')} onClick={() => setTool(tool === 'zoom' ? 'select' : 'zoom')} disabled={!pages.length} pressed={tool === 'zoom'} title={t('Zoom tool: drag a box to fit it, click to zoom in, Shift+click to zoom out')} />
                <RStack>
                  <RB icon={ArrowLeftRight} label={t('Fit width')} onClick={() => setMode('fit-width')} disabled={!pages.length} pressed={mode === 'fit-width'} title={t('Fit width (Ctrl+0)')} />
                  <RB icon={Expand} label={t('Fit page')} onClick={() => setMode('fit-page')} disabled={!pages.length} pressed={mode === 'fit-page'} title={t('Fit page')} />
                </RStack>
                <RStack>
                  <RB icon={Scan} label={t('Actual size')} onClick={() => setMode(1)} disabled={!pages.length} pressed={mode === 1} title={t('Actual size (Ctrl+1)')} />
                  <RB icon={ZoomIn} label={t('Zoom in')} onClick={() => stepZoom(1)} disabled={!pages.length} title={t('Zoom in (Ctrl++)')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Rulers and grid')}>
                <RStack>
                  <RB icon={Ruler} label={t('Rulers')} onClick={() => setAids({ ...aids, rulers: !aids.rulers })} pressed={aids.rulers} disabled={!pages.length} title={t('Show rulers. Drag from a ruler to add a guide; drag a guide back to remove it')} />
                  <RB icon={Grid3x3} label={t('Grid')} onClick={() => setAids({ ...aids, grid: aids.grid ? null : (10 * 72) / 25.4 })} pressed={!!aids.grid} disabled={!pages.length} title={t('Show a grid over the pages')} />
                  <RB icon={Magnet} label={t('Snap')} onClick={() => setAids({ ...aids, snap: !aids.snap })} pressed={aids.snap} disabled={!pages.length} title={t('Snap drawing and measuring to the grid and guides')} />
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
                  <RB icon={Eraser} label={t('Clear guides')} onClick={() => setGuides([])} disabled={!guides.length} title={t('Remove all guides')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Read aloud')}>
                {readerState === 'idle' ? (
                  <RB big icon={Volume2} label={t('Read')} onClick={() => void readAloud()} disabled={!pages.length || !voices.length} title={voices.length ? 'Read aloud from this page, or the selected text' : 'No speech voices are installed'} />
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
                  <RB icon={CircleStop} label={t('Stop')} onClick={() => reader.current?.stop()} disabled={readerState === 'idle'} title={t('Stop reading')} />
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
              <RGroup label={t('Reading')}>
                <RB big icon={BookOpenText} label={t('Reading mode')} onClick={() => setReadingMode(true)} disabled={!pages.length} title={t('Hide the ribbon and side pane (Ctrl+H). Esc to leave')} />
                <RStack>
                  <RB icon={Sun} label={t('Normal colours')} onClick={() => setPageColours('normal')} pressed={pageColours === 'normal'} title={t('Show pages in their own colours')} />
                  <RB icon={Moon} label={t('Night')} onClick={() => setPageColours('night')} pressed={pageColours === 'night'} title={t('Light text on dark pages (view only)')} />
                  <RB icon={Contrast} label={t('High contrast')} onClick={() => setPageColours('contrast')} pressed={pageColours === 'contrast'} title={t('High-contrast pages (view only)')} />
                </RStack>
              </RGroup>
              <RGroup label={t('Show')}>
                <RB big icon={PresentationIcon} label={t('Present')} onClick={() => void present()} disabled={!pages.length} title={t('Full-screen presentation from this page (F5). Esc to leave')} />
              </RGroup>
              <RGroup label={t('Rotate view')}>
                <RB big icon={RotateCcw} label={t('Left')} ariaLabel="Rotate view anticlockwise" onClick={() => rotateView(-1)} disabled={!pages.length} title={t('Rotate view anticlockwise (Ctrl+Shift+−). The file is not changed')} />
                <RB big icon={RotateCw} label={t('Right')} ariaLabel="Rotate view clockwise" onClick={() => rotateView(1)} disabled={!pages.length} title={t('Rotate view clockwise (Ctrl+Shift++). The file is not changed')} />
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
            <IconButton icon={X} label={t('Dismiss')} onClick={() => setNotice(null)} />
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
          <IconButton icon={ChevronUp} label={t('Previous match')} title={t('Previous match (Shift+Enter)')} onClick={() => stepMatch(-1)} disabled={!matches.length} />
          <IconButton icon={ChevronDown} label={t('Next match')} title={t('Next match (Enter)')} onClick={() => stepMatch(1)} disabled={!matches.length} />
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
          <IconButton icon={X} className="close" label={t('Close find')} title={t('Close (Esc)')} onClick={() => setSearchOpen(false)} />
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
      {player && <MediaPlayerDialog item={player} onClose={() => setPlayer(null)} />}
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
        <Modal title={t('This document is signed')} onClose={() => { breakPrompt(false); setBreakPrompt(null) }}>
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
        <Modal title={t('Apply redactions')} onClose={() => setRedactConfirm(false)}>
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
        <Modal title={t('Permissions password')} onClose={() => setOwnerPrompt(null)}>
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

      {scaleDialog && (
        <ScaleDialog
          pageCount={pages.length}
          currentPage={currentPage}
          selectedPages={pageSel}
          presets={scalePresets}
          onApply={applyScale}
          onSavePreset={(p) => changeScalePresets([...scalePresets.filter((x) => x.id !== p.id), p])}
          onDeletePreset={(id) => changeScalePresets(scalePresets.filter((x) => x.id !== id))}
          onClose={() => setScaleDialog(false)}
        />
      )}

      {calibrating && (
        <form
          className="page-dialog"
          aria-label="Calibrate scale"
          onSubmit={(e) => {
            e.preventDefault()
            try {
              setCalibrated(calibrate(calibrating.lengthPt, Number(calibrating.real.replace(',', '.')), calibrating.unit))
              setPageScales({})
              setScaleDirty(true)
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
        <PrintDialog
          pageCount={pages.length}
          sizes={pages}
          currentPage={currentPage}
          viewRange={printDialog.viewRange}
          selected={pageSel}
          prepare={preparePrint}
          onPrint={(job) => void runPrint(job)}
          onClose={() => setPrintDialog(null)}
        />
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

      {cmdDialog && (() => {
        const ctx: DocContext = { count: pages.length, current: Math.min(currentPage, Math.max(0, pages.length - 1)), selected: pageSel, sizes: pages }
        const close = () => setCmdDialog(null)
        switch (cmdDialog.kind) {
          case 'flatten':
            return (
              <FlattenDialog
                ctx={ctx}
                fieldPages={formFields.map((f) => f.widgets[0]?.page ?? -1).filter((p) => p >= 0)}
                annotPages={commentAnnots.map((a) => a.page)}
                onCancel={close}
                onSubmit={(what: FlattenWhat, only) => {
                  close()
                  let note = ''
                  void applyPageEdit(async (b) => {
                    const r = await flattenDocument(b, what, only)
                    const bits = [r.fields && `${r.fields} form field${r.fields === 1 ? '' : 's'}`, r.annots && `${r.annots} annotation${r.annots === 1 ? '' : 's'}`].filter(Boolean)
                    note = bits.length ? `Flattened ${bits.join(' and ')}: now part of the pages` : 'Nothing could be flattened on those pages'
                    return bits.length ? r.bytes : null
                  }).then(() => note && setNotice({ kind: 'info', text: note }))
                }}
              />
            )
          case 'export':
            return (
              <ExportTextDialog
                kind={cmdDialog.as}
                ctx={ctx}
                stem={exportStem()}
                dir={path ? path.replace(/[\\/][^\\/]*$/, '') : null}
                onCancel={close}
                onSubmit={(only, keep) => {
                  close()
                  void exportAs(cmdDialog.as, only, keep)
                }}
              />
            )
          case 'comments':
            return (
              <CommentsDialog
                mode={cmdDialog.mode}
                initialFormat={cmdDialog.format}
                annots={commentAnnots}
                ctx={ctx}
                onCancel={close}
                onSubmit={(r: CommentsDialogResult) => {
                  close()
                  if (r.mode === 'import') return void importComments(r)
                  if (r.format === 'csv') return void exportCommentsCsv(r.filter)
                  if (r.format === 'summary') return void summariseComments(r.filter)
                  void exportComments(r.format, r.filter)
                }}
              />
            )
          case 'saveas':
            return (
              <SaveAsDialog
                name={name.replace(/(\.pdf)?$/i, '.pdf')}
                size={formatSize(bytes.length)}
                onCancel={close}
                onSubmit={(c) => {
                  close()
                  void save(true, c)
                }}
              />
            )
        }
      })()}

      {stamps.dialogs}
      {signatures.dialogs}
      {combineOpen && <CombineDialog onClose={() => setCombineOpen(false)} onNewDoc={onNewDoc} notify={setNotice} />}

      {pageDialog && (() => {
        const common = { ctx: dialogCtx, name: baseName, onCancel: () => setPageDialog(null), onSubmit: (r: PageDialogResult) => void submitPageDialog(r) }
        switch (pageDialog.kind) {
          case 'insert':
            return <InsertDialog {...common} initialPage={pageDialog.insertAfter ?? currentPage + 1} />
          case 'extract':
            return <ExtractDialog {...common} />
          case 'delete':
            return <DeleteDialog {...common} />
          case 'rotate':
            return <RotateDialog {...common} />
          case 'replace':
            return <ReplaceDialog {...common} />
          case 'split':
            return <SplitDialog {...common} bookmarks={outline ?? []} />
          case 'merge':
            return <MergeDialog {...common} />
          case 'duplicate':
            return <DuplicateDialog {...common} />
          case 'move':
            return <MoveDialog {...common} />
        }
      })()}

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
                media={media}
                onPlayMedia={setPlayer}
                onSaveMedia={(m) => void saveMedia(m)}
                isLayerVisible={(key) => (hiddenLayers ? !hiddenLayers.has(key) : layers.find((l) => l.key === key)?.defaultOn !== false)}
                onToggleLayer={toggleLayer}
                onEditOutline={locked ? undefined : editOutline}
                measurements={
                  <MeasurePane
                    rows={measureList}
                    selectedId={selectedAnnot}
                    onGo={focusComment}
                    onLabel={labelMeasure}
                    onDelete={(ids) => removeMany(new Set(ids))}
                    onExportCsv={() => void exportMeasurementsCsv()}
                  />
                }
                comments={
                  <CommentsPane
                    annots={commentAnnots}
                    labels={pageLabels}
                    selectedId={selectedAnnot}
                    onFocus={focusComment}
                    onReply={addReply}
                    onStatus={setReviewState}
                    onDeleteReply={deleteReply}
                    onSummarise={() => setCmdDialog({ kind: 'comments', mode: 'export', format: 'summary' })}
                    onExportCsv={() => setCmdDialog({ kind: 'comments', mode: 'export', format: 'csv' })}
                    hiddenIds={hiddenComments}
                    onSetHidden={setCommentsHidden}
                    onStatusMany={setStatusMany}
                    onDeleteMany={(ids) => removeMany(new Set(ids))}
                    onSelectMany={selectComments}
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
              stampDrag={tool === 'stamp' && stamps.opts.drag}
              pageColours={pageColours}
              measurements={[]}
              onMeasure={onMeasure}
              measureLabel={measureLabel}
              objectSnap={snapOn ? snapKinds : null}
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
              annots={hiddenComments.size ? annots.filter((a) => !hiddenComments.has(a.id)) : annots}
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
                onApplyPreset={applyPresetToSelected}
                selectedCount={selectedIds.size}
                onPresetDefault={presetAsDefault}
                onFlags={setFlags}
                onClose={() => setPropsOpen(false)}
              />
            )}
          </>
        )}
      </div>
      <div className="statusbar toolbar" role="toolbar" aria-label="Page and zoom">
        <IconButton icon={PanelLeft} label={t('Side panel')} title={t('Show or hide the side panel')} onClick={() => setSidebar(sidebar ? null : 'pages')} pressed={sidebar !== null} />
        <span className="sep" />
        <IconButton icon={ChevronUp} label={t('Previous page')} onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 0} />
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
        <IconButton icon={ChevronDown} label={t('Next page')} onClick={() => goTo(currentPage + 1)} disabled={currentPage >= pages.length - 1} />
        <span className="status-fill" />
        <IconButton icon={ZoomOut} label={t('Zoom out')} title={t('Zoom out (Ctrl+−)')} onClick={() => stepZoom(-1)} disabled={!pages.length} />
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
        <IconButton icon={ZoomIn} label={t('Zoom in')} title={t('Zoom in (Ctrl++)')} onClick={() => stepZoom(1)} disabled={!pages.length} />
      </div>
    </div>
  )
}
