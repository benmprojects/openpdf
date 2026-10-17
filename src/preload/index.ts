import { contextBridge, ipcRenderer } from 'electron'
import type { RecoveryEntry, Settings } from '../main/settings'
import type { EncryptionInfo, EncryptOptions } from '../shared/pdfSecurity'
import type { PrintRunOptions } from '../shared/printPlan'
import type { ImageStamp } from '../main/stamps'
import type { CombineFile } from '../main/combineIo'
import type { CertInfo, ChainResult, SignSource } from '../main/signing'
import type { OcrResult } from '../main/ocr'
import type { ScanCapabilities, ScanOptions, ScannerInfo } from '../main/scan'
import type { BatchAction } from '../renderer/src/batch'
import type { CatalogueEntry, InstalledPlugin } from '../main/plugins'
import type { Place } from '../shared/places'
import type { UpdateStatus } from '../main/updates'
import type { PluginManifest } from '../shared/plugins'

export type { ImageStamp, CombineFile }

export type { RecoveryEntry, Settings }

export interface OpenedFile {
  name: string
  path: string
  data: Uint8Array
}

const api = {
  /** The Open dialog, starting in a folder when one is given. */
  openFileDialog: (startIn?: string): Promise<OpenedFile[]> => ipcRenderer.invoke('file:open-dialog', startIn),
  /** Synced cloud folders (OneDrive, SharePoint, Google Drive, Dropbox) found on this computer. */
  places: (): Promise<Place[]> => ipcRenderer.invoke('places:list'),
  initialFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('file:initial'),
  readFile: (path: string): Promise<OpenedFile> => ipcRenderer.invoke('file:read', path),
  /** Overwrites the PDF at `path`. */
  saveFile: (path: string, data: Uint8Array): Promise<{ name: string; path: string }> =>
    ipcRenderer.invoke('file:save', path, data),
  /** Shows a Save dialog; resolves null if cancelled. */
  saveFileAs: (suggestedName: string, data: Uint8Array): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke('file:save-as', suggestedName, data),
  /** Asks for a folder and writes the files into it, never overwriting. Resolves null if cancelled. */
  saveMany: (files: { name: string; data: Uint8Array }[], into?: string | null): Promise<{ dir: string; written: string[] } | null> =>
    ipcRenderer.invoke('file:save-many', files, into ?? null),
  /** Asks for a folder and writes files of any type into it, never overwriting. Resolves null if cancelled. */
  saveFiles: (files: { name: string; data: Uint8Array }[]): Promise<{ dir: string; written: string[] } | null> => ipcRenderer.invoke('file:save-files', files),
  /** Save dialog for a text file; resolves to the written path, or null if cancelled. */
  saveText: (suggested: string, text: string, filter: { name: string; ext: string }): Promise<string | null> =>
    ipcRenderer.invoke('file:save-text', suggested, text, filter),
  /** Save dialog for any bytes; resolves to the written path, or null if cancelled. */
  saveData: (suggested: string, data: Uint8Array, filter: { name: string; ext: string }): Promise<string | null> =>
    ipcRenderer.invoke('file:save-data', suggested, data, filter),
  listStamps: (): Promise<ImageStamp[]> => ipcRenderer.invoke('stamps:list'),
  /** Asks for PNG or JPEG files and copies them into the stamp library. */
  addStamps: (category?: string): Promise<{ added: number; refused: string[] }> => ipcRenderer.invoke('stamps:add', category),
  removeStamp: (id: string): Promise<void> => ipcRenderer.invoke('stamps:remove', id),
  /** Renames an image stamp or moves it to another category. */
  updateStamp: (id: string, change: { name?: string; category?: string }): Promise<void> => ipcRenderer.invoke('stamps:update', id, change),
  /** Adds PNG or JPEG pictures held in memory (clipboard, snapshot, rendered page, imported collection) to the library. */
  addStampData: (items: { name: string; category: string; data: Uint8Array }[]): Promise<{ added: ImageStamp[]; refused: string[] }> => ipcRenderer.invoke('stamps:add-data', items),
  /** Saved text stamps, recently used and numbering (JSON text), or null if none. */
  readStampMeta: (): Promise<string | null> => ipcRenderer.invoke('stamps:meta-read'),
  writeStampMeta: (json: string): Promise<void> => ipcRenderer.invoke('stamps:meta-write', json),
  /** Asks for one file to attach; resolves null if cancelled. */
  pickFile: (filter?: { name: string; ext: string[] }): Promise<{ name: string; data: Uint8Array } | null> => ipcRenderer.invoke('file:pick-one', filter),
  /** Asks, then opens a web or mail link in the default app. Resolves false if refused or cancelled. */
  openLink: (url: string): Promise<boolean> => ipcRenderer.invoke('link:open', url),
  /** Sends form data to a web address after asking; resolves what happened. */
  submitForm: (url: string, contentType: string, body: Uint8Array): Promise<{ sent: boolean; status: number; note: string }> => ipcRenderer.invoke('form:submit', url, contentType, body),
  setFullScreen: (on: boolean): Promise<void> => ipcRenderer.invoke('window:fullscreen', on),
  copyImage: (png: Uint8Array): Promise<void> => ipcRenderer.invoke('clipboard:write-image', png),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('file:pick-folder'),
  listPdfs: (dir: string, recursive: boolean): Promise<string[]> => ipcRenderer.invoke('file:list-pdfs', dir, recursive),
  /** Save As dialog for an embedded file; resolves to the written path, or null if cancelled. */
  saveAttachment: (name: string, data: Uint8Array): Promise<string | null> => ipcRenderer.invoke('file:save-attachment', name, data),
  /** Whether a file is encrypted, whether it needs a password, and its permissions. */
  encryptionInfo: (data: Uint8Array, password?: string): Promise<EncryptionInfo> => ipcRenderer.invoke('pdf:encryption-info', data, password),
  /** The file without its encryption; rejects with "invalid password" when the password is wrong. */
  decryptPdf: (data: Uint8Array, password: string): Promise<Uint8Array> => ipcRenderer.invoke('pdf:decrypt', data, password),
  /** The file encrypted with new passwords and permissions. */
  encryptPdf: (data: Uint8Array, o: EncryptOptions): Promise<Uint8Array> => ipcRenderer.invoke('pdf:encrypt', data, o),
  /** Translations the user added in their data folder (code -> catalogue). */
  userLocales: (): Promise<Record<string, { name: string; messages: Record<string, string> }>> => ipcRenderer.invoke('locales:user'),
  /** Updates, opt in: look at the feed, download, restart to install. */
  checkForUpdates: (feed: string): Promise<UpdateStatus> => ipcRenderer.invoke('updates:check', feed),
  downloadUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke('updates:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('updates:status'),
  /** Plugins. Installing from a folder or zip asks for it; each resolves null when cancelled. */
  pluginsList: (): Promise<InstalledPlugin[]> => ipcRenderer.invoke('plugins:list'),
  pluginInstallFolder: (): Promise<PluginManifest | null> => ipcRenderer.invoke('plugins:install-folder'),
  pluginInstallZip: (): Promise<PluginManifest | null> => ipcRenderer.invoke('plugins:install-zip'),
  pluginUninstall: (id: string): Promise<void> => ipcRenderer.invoke('plugins:uninstall', id),
  pluginCatalogue: (url: string): Promise<CatalogueEntry[]> => ipcRenderer.invoke('plugins:catalogue', url),
  pluginInstallCatalogue: (entry: CatalogueEntry): Promise<PluginManifest> => ipcRenderer.invoke('plugins:install-catalogue', entry),
  /** Command-line run: the job to do, and handing back the results (the program then exits). */
  cliJob: (): Promise<{ steps: BatchAction['steps']; inputs: string[]; recursive: boolean; outDir: string | null; suffix: string } | null> => ipcRenderer.invoke('cli:job'),
  cliDone: (results: unknown[]): Promise<void> => ipcRenderer.invoke('cli:done', results),
  /** Batch processing: PDFs among files and folders, one read, one result written (never overwriting). */
  batchExpand: (paths: string[], recursive: boolean): Promise<string[]> => ipcRenderer.invoke('batch:expand', paths, recursive),
  batchRead: (path: string): Promise<{ name: string; data: Uint8Array }> => ipcRenderer.invoke('batch:read', path),
  batchWrite: (source: string, outDir: string | null, suffix: string, data: Uint8Array): Promise<string> => ipcRenderer.invoke('batch:write', source, outDir, suffix, data),
  batchPick: (folders: boolean): Promise<string[]> => ipcRenderer.invoke('batch:pick-inputs', folders),
  batchActions: (): Promise<BatchAction[]> => ipcRenderer.invoke('batch:actions'),
  batchSaveAction: (a: BatchAction): Promise<BatchAction[]> => ipcRenderer.invoke('batch:save-action', a),
  batchDeleteAction: (name: string): Promise<BatchAction[]> => ipcRenderer.invoke('batch:delete-action', name),
  /** Scanners Windows knows about. */
  listScanners: (): Promise<ScannerInfo[]> => ipcRenderer.invoke('scan:devices'),
  /** Whether the scanner reports duplex scanning from its feeder. */
  scanCapabilities: (deviceId?: string): Promise<ScanCapabilities> => ipcRenderer.invoke('scan:capabilities', deviceId),
  /** Scans; one PNG per sheet (empty when the scanner's own window was cancelled). */
  scan: (o: ScanOptions): Promise<Uint8Array[]> => ipcRenderer.invoke('scan:acquire', o),
  /** Languages text recognition offers, and which are already on this computer. */
  ocrLanguages: (): Promise<{ installed: string[]; all: [string, string][] }> => ipcRenderer.invoke('ocr:languages'),
  /** Recognises the text in a page image (PNG or JPEG). */
  ocrRecognise: (image: Uint8Array, languages: string[]): Promise<OcrResult> => ipcRenderer.invoke('ocr:recognise', image, languages),
  /** Picks several files at once (empty when cancelled). */
  pickFiles: (filter?: { name: string; ext: string[] }): Promise<{ name: string; data: Uint8Array }[]> => ipcRenderer.invoke('file:pick-many', filter),
  /** Asks for an .html file and prints it to a PDF (scripts and network off); null when cancelled. */
  htmlToPdf: (): Promise<{ name: string; data: Uint8Array } | null> => ipcRenderer.invoke('convert:html-pick'),
  /** Prints markup to a PDF. */
  htmlTextToPdf: (html: string): Promise<Uint8Array> => ipcRenderer.invoke('convert:html-text', html),
  /** Combine files: asks for files or a folder; each resolves the supported files chosen (empty when cancelled). */
  combinePick: (): Promise<CombineFile[]> => ipcRenderer.invoke('combine:pick'),
  combineFolder: (): Promise<CombineFile[]> => ipcRenderer.invoke('combine:folder'),
  /** The bytes of a listed file, or a listed Office file converted to PDF (needs LibreOffice). */
  combineRead: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('combine:read', path),
  combineOffice: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('combine:office', path),
  /** Whether LibreOffice is installed (for converting Word, Excel and PowerPoint files). */
  officeAvailable: (): Promise<boolean> => ipcRenderer.invoke('convert:office-available'),
  /** Asks for an Office file and converts it with LibreOffice; null when cancelled. */
  officeToPdf: (): Promise<{ name: string; data: Uint8Array } | null> => ipcRenderer.invoke('convert:office-pick'),
  /** The image on the clipboard as a PNG, or null. */
  clipboardImage: (): Promise<Uint8Array | null> => ipcRenderer.invoke('clipboard:read-image'),
  /** A PNG of the whole screen (the window hides for a moment). */
  screenshot: (): Promise<Uint8Array | null> => ipcRenderer.invoke('convert:screenshot'),
  /** Certificates with a private key in the Windows personal store. */
  signCertificates: (): Promise<CertInfo[]> => ipcRenderer.invoke('sign:certs'),
  /** Describes the certificate in a .pfx file; rejects when the password is wrong. */
  pfxInfo: (data: Uint8Array, password: string): Promise<CertInfo> => ipcRenderer.invoke('sign:pfx-info', data, password),
  /** A detached CMS signature over `data`, made with a store certificate or a .pfx file. */
  signCms: (data: Uint8Array, source: SignSource): Promise<Uint8Array> => ipcRenderer.invoke('sign:cms', data, source),
  /** Sends a time-stamp request (DER) to a time-stamping server and returns its response. */
  timestamp: (url: string, request: Uint8Array): Promise<Uint8Array> => ipcRenderer.invoke('sign:timestamp', url, request),
  /** Whether Windows trusts the first of these DER certificates. */
  chainStatus: (certs: Uint8Array[]): Promise<ChainResult> => ipcRenderer.invoke('sign:chain', certs),
  /** `plain` encrypted like `original` (same passwords and permissions). */
  copyEncryption: (plain: Uint8Array, original: Uint8Array, password: string): Promise<Uint8Array> => ipcRenderer.invoke('pdf:copy-encryption', plain, original, password),
  /** An installed font file matching a PDF font name (Windows), or null. */
  findFont: (name: string, bold: boolean, italic: boolean): Promise<{ data: Uint8Array; family: string } | null> => ipcRenderer.invoke('font:find', name, bold, italic),
  /** Rewrites a PDF through qpdf in the main process. */
  qpdf: (data: Uint8Array, o: { objectStreams: boolean; recompress: boolean; removeUnusedResources: boolean; linearise: boolean }): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdf:qpdf', data, o),
  /** Printing: start a job, send each page as a PNG with its size in points, then print (shows the system dialog). */
  printBegin: (): Promise<string> => ipcRenderer.invoke('print:begin'),
  printPage: (job: string, n: number, png: Uint8Array, w: number, h: number): Promise<void> =>
    ipcRenderer.invoke('print:page', job, n, png, w, h),
  printRun: (job: string, opts: PrintRunOptions): Promise<{ ok: boolean; error?: string; pdfPath?: string }> =>
    ipcRenderer.invoke('print:run', job, opts),
  /** The installed printers, for the Print dialog. */
  printPrinters: (): Promise<{ name: string; displayName: string; isDefault: boolean }[]> => ipcRenderer.invoke('print:printers'),
  printCancel: (job: string): Promise<void> => ipcRenderer.invoke('print:cancel', job),
  /** Resolves null if the file is gone (it is then dropped from the recent list). */
  openRecent: (path: string): Promise<OpenedFile | null> => ipcRenderer.invoke('file:open-recent', path),
  /** Files opened from outside while the app runs (Explorer, file association). Returns an unsubscribe. */
  onOpenFiles: (cb: (files: OpenedFile[]) => void): (() => void) => {
    const h = (_e: unknown, files: OpenedFile[]) => cb(files)
    ipcRenderer.on('file:open-files', h)
    return () => ipcRenderer.removeListener('file:open-files', h)
  },
  /** Downloads a PDF from an https address (to a temporary file, size-limited); the error is a message to show. */
  openUrl: (address: string): Promise<{ ok: true; name: string; data: Uint8Array } | { ok: false; error: string }> => ipcRenderer.invoke('url:open', address),
  /** Shows a saved PDF in Explorer (to attach by hand), or starts a message without it. */
  sendMail: (path: string, mode: 'reveal' | 'compose'): Promise<boolean> => ipcRenderer.invoke('mail:send', path, mode),
  /** Settings to a JSON file (null when cancelled), and back (null when cancelled). */
  exportSettings: (): Promise<string | null> => ipcRenderer.invoke('settings:export'),
  importSettings: (): Promise<{ ok: true; settings: Settings; applied: number; skipped: string[] } | { ok: false; error: string } | null> => ipcRenderer.invoke('settings:import'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
  recoverySave: (key: string, meta: { name: string; path?: string }, data: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('recovery:save', key, meta, data),
  recoveryClear: (key: string): Promise<void> => ipcRenderer.invoke('recovery:clear', key),
  recoveryList: (): Promise<RecoveryEntry[]> => ipcRenderer.invoke('recovery:list'),
  recoveryRead: (key: string): Promise<Uint8Array> => ipcRenderer.invoke('recovery:read', key),
  recoveryClearAll: (): Promise<void> => ipcRenderer.invoke('recovery:clear-all')
}

contextBridge.exposeInMainWorld('openpdf', api)
export type OpenPdfApi = typeof api
