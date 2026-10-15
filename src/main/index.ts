import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeTheme, net, shell } from 'electron'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { sheetGrid, sheetSlots, type PrintLayout } from '../shared/printLayout'
import { findFont } from './fonts'
import { editMenuTemplate } from './spellMenu'
import { copyEncryption, decryptPdf, encryptionInfo, encryptPdf, runQpdf } from './qpdf'
import { chainStatus, listCertificates, pfxInfo, signCms, type SignSource } from './signing'
import { findLibreOffice, htmlToPdf, officeToPdf, screenshot } from './convert'
import { installedLanguages, OCR_LANGUAGES, recognise, stopOcr } from './ocr'
import { deleteAction, expandPdfs, listActions, readPdf as readBatchPdf, saveAction, writeResult } from './batchIo'
import { HELP, loadAction, parseCli } from './cli'
import { listPlaces } from './places'
import { userCatalogues } from './locales'
import { checkForUpdates, downloadUpdate, installUpdate, updateStatus } from './updates'
import type { Place } from '../shared/places'
import { fetchCatalogue, installFromCatalogue, installFromFolder, installFromZip, listPlugins, uninstallPlugin, type CatalogueEntry } from './plugins'
import type { BatchAction } from '../renderer/src/batch'
import { listScanners, scan, type ScanOptions } from './scan'
import { addStamps, listStamps, removeStamp } from './stamps'
import {
  addRecent,
  clearAllRecovery,
  clearRecovery,
  listRecovery,
  loadSettings,
  readRecovery,
  removeRecent,
  saveRecovery,
  updateSettings,
  type Settings
} from './settings'

/**
 * Test hook: with OPENPDF_E2E=1 the file dialogs are answered from environment variables instead of being
 * shown, so end-to-end checks can drive insert, merge, extract and split. Does nothing in normal use.
 * OPENPDF_E2E_USERDATA points settings, recent files and recovery at a scratch folder.
 */
const e2e = process.env.OPENPDF_E2E === '1'
if (e2e && process.env.OPENPDF_E2E_USERDATA) app.setPath('userData', process.env.OPENPDF_E2E_USERDATA)

// One window: opening a PDF from Explorer while the app runs adds a tab to the running window.
// A command-line run (OpenPDF --batch ...) is its own process: it neither takes the lock nor opens the main window.
const cli = parseCli(process.argv.slice(app.isPackaged ? 1 : 2))
if (!e2e && !cli && !app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null

const pdfArgs = (argv: string[]) => argv.slice(1).filter((a) => a.toLowerCase().endsWith('.pdf') && !a.startsWith('-'))

app.on('second-instance', async (_e, argv, cwd) => {
  const win = mainWindow
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
  const files = await Promise.all(pdfArgs(argv).map((p) => openForUser(resolve(cwd, p)).catch(() => null)))
  const ok = files.filter((f) => f !== null)
  if (ok.length) win.webContents.send('file:open-files', ok)
})

/** Matches the tab strip's background (--panel-2) and text colours in styles.css. */
function titleBarColours() {
  const dark = nativeTheme.shouldUseDarkColors
  return { color: dark ? '#1d1f22' : '#f3f4f7', symbolColor: dark ? '#e6e8eb' : '#1c2027', height: 38 }
}

function createWindow(): void {
  // Test hook: test windows open off-screen and without taking focus, unless OPENPDF_E2E_SHOW=1.
  const hideForTests = e2e && process.env.OPENPDF_E2E_SHOW !== '1'
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    ...(hideForTests ? { x: -30000, y: -30000, show: false, skipTaskbar: true } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#17181b' : '#e9ebef',
    // The document tab strip doubles as the title bar; Windows draws its own buttons over the right-hand end.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColours(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // The renderer blocks unload while a tab has unsaved annotations; ask before discarding them.
  win.webContents.on('will-prevent-unload', (e) => {
    // Test hook: OPENPDF_E2E_DISCARD=1 answers "Close and discard" so tests can close a window with unsaved work.
    const choice = e2e && process.env.OPENPDF_E2E_DISCARD === '1' ? 0 : dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Close and discard', 'Keep open'],
      defaultId: 1,
      cancelId: 1,
      message: 'Some documents have unsaved annotations.',
      detail: 'Closing now discards them.'
    })
    if (choice === 0) {
      // Discarding on purpose: the recovery snapshots of those documents must not come back next time.
      void clearAllRecovery()
      e.preventDefault()
    }
  })
  // Right-click in a text box: spelling suggestions and the edit commands.
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return
    Menu.buildFromTemplate(
      editMenuTemplate(params, {
        replace: (w) => win.webContents.replaceMisspelling(w),
        addWord: (w) => win.webContents.session.addWordToSpellCheckerDictionary(w)
      })
    ).popup({ window: win })
  })
  mainWindow = win
  const retint = () => {
    if (!win.isDestroyed()) win.setTitleBarOverlay(titleBarColours())
  }
  nativeTheme.on('updated', retint)
  win.on('closed', () => nativeTheme.off('updated', retint))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  // Shown without activating, so it renders normally but stays off-screen and out of the way.
  if (hideForTests) win.showInactive()
}

async function readPdf(path: string) {
  const data = await readFile(path)
  return { name: basename(path), path, data: new Uint8Array(data) }
}

/** Reads a PDF the user opened as a document (not one inserted into another), and remembers it as recent. */
async function openForUser(path: string) {
  const f = await readPdf(path)
  await addRecent(path).catch(() => {})
  return f
}

/** Synced cloud folders (OneDrive, SharePoint, Google Drive, Dropbox) to offer as places. Tests supply a list. */
ipcMain.handle('places:list', async () => {
  if (e2e && process.env.OPENPDF_E2E_PLACES) return JSON.parse(process.env.OPENPDF_E2E_PLACES) as Place[]
  return listPlaces()
})

ipcMain.handle('file:open-dialog', async (_e, startIn?: unknown) => {
  if (e2e && process.env.OPENPDF_E2E_OPENDIR_LOG) await writeFile(process.env.OPENPDF_E2E_OPENDIR_LOG, typeof startIn === 'string' ? startIn : '')
  if (e2e && process.env.OPENPDF_E2E_OPEN) return Promise.all(process.env.OPENPDF_E2E_OPEN.split(';').map(readPdf))
  const res = await dialog.showOpenDialog({
    ...(typeof startIn === 'string' && startIn ? { defaultPath: startIn } : {}),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  })
  if (res.canceled) return []
  return Promise.all(res.filePaths.map(openForUser))
})

/** Opens a recent file; one that has gone missing is dropped from the list and reported as null. */
ipcMain.handle('file:open-recent', async (_e, path: string) => {
  const s = await loadSettings()
  if (!s.recent.includes(path)) throw new Error('Not a recent file')
  try {
    return await openForUser(path)
  } catch {
    await removeRecent(path)
    return null
  }
})

ipcMain.handle('settings:get', () => loadSettings())
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => updateSettings(patch))

ipcMain.handle('recovery:save', (_e, key: string, meta: { name: string; path?: string }, data: Uint8Array) =>
  saveRecovery(key, meta, data)
)
ipcMain.handle('recovery:clear', (_e, key: string) => clearRecovery(key))
ipcMain.handle('recovery:list', () => listRecovery())
ipcMain.handle('recovery:read', (_e, key: string) => readRecovery(key))
ipcMain.handle('recovery:clear-all', () => clearAllRecovery())

ipcMain.handle('file:read', (_e, path: string) => readPdf(path))

/** Writes to a temporary file first so a failed write cannot leave a half-written PDF behind. */
async function writePdf(path: string, data: Uint8Array) {
  if (!path.toLowerCase().endsWith('.pdf')) throw new Error('Only .pdf files can be saved.')
  const tmp = `${path}.openpdf-tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
  return { name: basename(path), path }
}

async function writeDocument(path: string, data: Uint8Array) {
  const saved = await writePdf(path, data)
  await addRecent(saved.path).catch(() => {})
  return saved
}

ipcMain.handle('file:save', (_e, path: string, data: Uint8Array) => writeDocument(path, data))

ipcMain.handle('file:save-as', async (e, suggestedName: string, data: Uint8Array) => {
  if (e2e && process.env.OPENPDF_E2E_SAVE) return writeDocument(process.env.OPENPDF_E2E_SAVE, data)
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { defaultPath: suggestedName, filters: [{ name: 'PDF documents', extensions: ['pdf'] }] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  return writeDocument(res.filePath, data)
})

/** Saves a text file (CSV export and the like), UTF-8 with a byte-order mark so Excel reads it correctly. */
ipcMain.handle('file:save-text', async (e, suggested: string, text: string, filter: { name: string; ext: string }) => {
  let target: string | undefined
  if (e2e && process.env.OPENPDF_E2E_SAVE_TEXT) target = process.env.OPENPDF_E2E_SAVE_TEXT
  else {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { defaultPath: suggested, filters: [{ name: filter.name, extensions: [filter.ext] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    target = res.filePath
  }
  await writeFile(`${target}.openpdf-tmp`, '\ufeff' + text, 'utf8')
  await rename(`${target}.openpdf-tmp`, target)
  return target
})

/** Saves bytes under a name and type the user picks (comment exports and the like). */
ipcMain.handle('file:save-data', async (e, suggested: string, data: Uint8Array, filter: { name: string; ext: string }) => {
  let target: string | undefined
  if (e2e && process.env.OPENPDF_E2E_SAVE_TEXT) target = process.env.OPENPDF_E2E_SAVE_TEXT
  else {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { defaultPath: suggested, filters: [{ name: filter.name, extensions: [filter.ext] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    target = res.filePath
  }
  await writeFile(`${target}.openpdf-tmp`, data)
  await rename(`${target}.openpdf-tmp`, target)
  return target
})

/** Image stamp library. */
ipcMain.handle('stamps:list', () => listStamps())
ipcMain.handle('stamps:remove', (_e, id: string) => removeStamp(id))
ipcMain.handle('stamps:add', async (e) => {
  let paths: string[]
  if (e2e && process.env.OPENPDF_E2E_IMAGES) paths = process.env.OPENPDF_E2E_IMAGES.split(';')
  else {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      title: 'Add image stamps',
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return { added: 0, refused: [] }
    paths = res.filePaths
  }
  return addStamps(paths)
})

/** Picks one file to attach (any type, or as filtered); up to 100 MB. Resolves null if cancelled. */
ipcMain.handle('file:pick-one', async (e, filter?: { name: string; ext: string[] }) => {
  let path: string | undefined
  if (e2e && process.env.OPENPDF_E2E_PICK) path = process.env.OPENPDF_E2E_PICK
  else {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openFile'] as 'openFile'[], filters: filter ? [{ name: filter.name, extensions: filter.ext }] : [] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    path = res.filePaths[0]
  }
  const data = await readFile(path)
  if (data.length > 100 * 1024 * 1024) throw new Error('Files over 100 MB cannot be attached.')
  return { name: basename(path), data: new Uint8Array(data) }
})

/** Scanning through Windows' WIA. Tests give picture paths separated by "|" instead of using a scanner. */
ipcMain.handle('scan:devices', () => listScanners())
ipcMain.handle('scan:acquire', async (_e, o: ScanOptions) => {
  if (e2e && process.env.OPENPDF_E2E_SCAN) return Promise.all(process.env.OPENPDF_E2E_SCAN.split('|').map(async (f) => new Uint8Array(await readFile(f))))
  return scan(o)
})

/** Translations added by the user, from the locales folder of the user's data folder. */
ipcMain.handle('locales:user', () => userCatalogues(join(app.getPath('userData'), 'locales')))

/** Updates (opt in): check, download, install. */
ipcMain.handle('updates:check', async (_e, feed: unknown) => checkForUpdates(typeof feed === 'string' ? feed : ''))
ipcMain.handle('updates:download', () => downloadUpdate())
ipcMain.handle('updates:install', () => installUpdate())
ipcMain.handle('updates:status', () => updateStatus())

/** Plugins: installed under the user's data folder, from a folder, a zip or a catalogue. */
const pluginsRoot = () => join(app.getPath('userData'), 'plugins')
const asFetch = net.fetch.bind(net) as unknown as typeof fetch
ipcMain.handle('plugins:list', () => listPlugins(pluginsRoot()))
ipcMain.handle('plugins:install-folder', async (e) => {
  let folder: string | undefined
  if (e2e && process.env.OPENPDF_E2E_PLUGIN_PICK) folder = process.env.OPENPDF_E2E_PLUGIN_PICK
  else {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory'] as 'openDirectory'[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    folder = res.canceled ? undefined : res.filePaths[0]
  }
  return folder ? installFromFolder(pluginsRoot(), folder) : null
})
ipcMain.handle('plugins:install-zip', async (e) => {
  let file: string | undefined
  if (e2e && process.env.OPENPDF_E2E_PLUGIN_PICK) file = process.env.OPENPDF_E2E_PLUGIN_PICK
  else {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openFile'] as 'openFile'[], filters: [{ name: 'Plugins', extensions: ['zip'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    file = res.canceled ? undefined : res.filePaths[0]
  }
  return file ? installFromZip(pluginsRoot(), new Uint8Array(await readFile(file))) : null
})
ipcMain.handle('plugins:uninstall', (_e, id: unknown) => uninstallPlugin(pluginsRoot(), String(id)))
ipcMain.handle('plugins:catalogue', (_e, url: unknown) => fetchCatalogue(String(url), asFetch))
ipcMain.handle('plugins:install-catalogue', (_e, entry: CatalogueEntry) => installFromCatalogue(pluginsRoot(), entry, asFetch))

/** Batch processing: files in, results out (never overwriting), and the saved actions. */
ipcMain.handle('batch:expand', (_e, paths: unknown, recursive: unknown) => expandPdfs(Array.isArray(paths) ? paths.filter((x): x is string => typeof x === 'string') : [], recursive === true))
ipcMain.handle('batch:read', (_e, path: unknown) => readBatchPdf(String(path)))
ipcMain.handle('batch:write', (_e, source: unknown, outDir: unknown, suffix: unknown, data: Uint8Array) =>
  writeResult(String(source), typeof outDir === 'string' && outDir ? outDir : null, typeof suffix === 'string' ? suffix : '', new Uint8Array(data))
)
ipcMain.handle('batch:actions', () => listActions())
ipcMain.handle('batch:save-action', (_e, a: BatchAction) => saveAction(a))
ipcMain.handle('batch:delete-action', (_e, name: unknown) => deleteAction(String(name)))
ipcMain.handle('batch:pick-inputs', async (e, folders: boolean) => {
  if (e2e && process.env.OPENPDF_E2E_BATCH_PICK) return process.env.OPENPDF_E2E_BATCH_PICK.split('|')
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { properties: (folders ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']) as ('openDirectory' | 'openFile' | 'multiSelections')[], filters: folders ? [] : [{ name: 'PDF documents', extensions: ['pdf'] }] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? [] : res.filePaths
})

/** Text recognition (OCR): the languages, and one page image at a time. */
ipcMain.handle('ocr:languages', async () => ({ installed: await installedLanguages(), all: OCR_LANGUAGES }))
ipcMain.handle('ocr:recognise', (_e, image: Uint8Array, langs: unknown) => recognise(new Uint8Array(image), Array.isArray(langs) ? langs.filter((l): l is string => typeof l === 'string') : []))
app.on('before-quit', () => void stopOcr())

/** Picks several files (images to combine into a PDF, say). Tests give their paths separated by "|". */
ipcMain.handle('file:pick-many', async (e, filter?: { name: string; ext: string[] }) => {
  let paths: string[]
  if (e2e && process.env.OPENPDF_E2E_PICK) paths = process.env.OPENPDF_E2E_PICK.split('|')
  else {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[], filters: filter ? [{ name: filter.name, extensions: filter.ext }] : [] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths.length) return []
    paths = res.filePaths
  }
  const out: { name: string; data: Uint8Array }[] = []
  let total = 0
  for (const path of paths.slice(0, 500)) {
    const data = await readFile(path)
    total += data.length
    if (total > 500 * 1024 * 1024) throw new Error('Those files are too large to combine (over 500 MB).')
    out.push({ name: basename(path), data: new Uint8Array(data) })
  }
  return out
})

/** Asks for a file with one of these extensions and returns its path; tests supply it. */
async function pickPath(e: Electron.IpcMainInvokeEvent, name: string, ext: string[]): Promise<string | null> {
  if (e2e && process.env.OPENPDF_E2E_PICK) return process.env.OPENPDF_E2E_PICK
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { properties: ['openFile'] as 'openFile'[], filters: [{ name, extensions: ext }] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
}

/** Web page to PDF: pick an .html file and print it. Resolves null if cancelled. */
ipcMain.handle('convert:html-pick', async (e) => {
  const path = await pickPath(e, 'Web pages', ['html', 'htm'])
  return path ? { name: basename(path).replace(/\.[^.]*$/, '') + '.pdf', data: await htmlToPdf({ path }) } : null
})
ipcMain.handle('convert:html-text', async (_e, html: unknown) => htmlToPdf({ html: typeof html === 'string' ? html : '' }))

/** Word, Excel, PowerPoint and OpenDocument files to PDF through an installed LibreOffice. */
ipcMain.handle('convert:office-available', () => findLibreOffice() !== null)
ipcMain.handle('convert:office-pick', async (e) => {
  const path = await pickPath(e, 'Office documents', ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'csv'])
  return path ? { name: basename(path).replace(/\.[^.]*$/, '') + '.pdf', data: await officeToPdf(path) } : null
})

/** The image on the clipboard as a PNG, or null. Tests read a file instead: other programs can change the system clipboard. */
ipcMain.handle('clipboard:read-image', async () => {
  if (e2e && process.env.OPENPDF_E2E_CLIPIMG) return new Uint8Array(await readFile(process.env.OPENPDF_E2E_CLIPIMG))
  for (const item of await clipboard.read()) {
    const type = item.types.includes('image/png') ? 'image/png' : item.types.find((t) => t.startsWith('image/'))
    if (type) return new Uint8Array(await ((await item.getType(type)) as Blob).arrayBuffer())
  }
  return null
})

/** A screenshot of the primary screen. Tests read a file instead. */
ipcMain.handle('convert:screenshot', async (e) => {
  if (e2e && process.env.OPENPDF_E2E_CLIPIMG) return new Uint8Array(await readFile(process.env.OPENPDF_E2E_CLIPIMG))
  return screenshot(BrowserWindow.fromWebContents(e.sender))
})

/** Opens a link from a document in the browser, after asking. Only web and mail links. */
ipcMain.handle('link:open', async (e, url: string) => {
  let parsed: URL
  try {
    parsed = new URL(url.includes(':') ? url : `https://${url}`)
  } catch {
    return false
  }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return false
  if (e2e && process.env.OPENPDF_E2E_LINKS) {
    await writeFile(process.env.OPENPDF_E2E_LINKS, parsed.href)
    return true
  }
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { type: 'question' as const, buttons: ['Open', 'Cancel'], defaultId: 0, cancelId: 1, message: 'Open this link?', detail: parsed.href }
  const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (res.response !== 0) return false
  await shell.openExternal(parsed.href)
  return true
})

/** Presentation mode. */
ipcMain.handle('window:fullscreen', (e, on: boolean) => {
  BrowserWindow.fromWebContents(e.sender)?.setFullScreen(!!on)
})

/** Puts a PNG on the clipboard (snapshot tool). */
ipcMain.handle('clipboard:write-image', async (_e, png: Uint8Array) => {
  const sig = [0x89, 0x50, 0x4e, 0x47]
  if (!sig.every((b, i) => png[i] === b)) throw new Error('Not a PNG image')
  // Tests read the image from a file: other programs on the machine can take the system clipboard.
  if (e2e && process.env.OPENPDF_E2E_CLIP) return writeFile(process.env.OPENPDF_E2E_CLIP, png)
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
})

/** Asks for a folder to search. Resolves null if cancelled. */
ipcMain.handle('file:pick-folder', async (e) => {
  if (e2e && process.env.OPENPDF_E2E_SEARCH_DIR) return process.env.OPENPDF_E2E_SEARCH_DIR
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { properties: ['openDirectory'] as 'openDirectory'[] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? null : (res.filePaths[0] ?? null)
})

/** PDF files in a folder (and its subfolders if asked), sorted by path, at most 5000. */
ipcMain.handle('file:list-pdfs', async (_e, dir: string, recursive: boolean) => {
  const out: string[] = []
  const walk = async (d: string, depth: number) => {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return // unreadable folder: skip it
    }
    for (const ent of entries) {
      if (out.length >= 5000) return
      const full = join(d, ent.name)
      if (ent.isFile() && ent.name.toLowerCase().endsWith('.pdf')) out.push(full)
      else if (recursive && ent.isDirectory() && !ent.isSymbolicLink() && depth < 32) await walk(full, depth + 1)
    }
  }
  await walk(dir, 0)
  return out.sort((a, b) => a.localeCompare(b))
})

/** Encryption: what a file's protection is, removing it with a password, adding it, copying it onto an edited copy. */
ipcMain.handle('pdf:encryption-info', (_e, data: Uint8Array, password: unknown) => encryptionInfo(new Uint8Array(data), typeof password === 'string' ? password : ''))
ipcMain.handle('pdf:decrypt', (_e, data: Uint8Array, password: unknown) => decryptPdf(new Uint8Array(data), typeof password === 'string' ? password : ''))
ipcMain.handle('pdf:encrypt', (_e, data: Uint8Array, o: Parameters<typeof encryptPdf>[1]) => {
  if (!o || typeof o.userPassword !== 'string' || typeof o.ownerPassword !== 'string' || (o.keyLength !== 128 && o.keyLength !== 256)) throw new Error('Invalid security settings')
  return encryptPdf(new Uint8Array(data), o)
})
ipcMain.handle('pdf:copy-encryption', (_e, plain: Uint8Array, original: Uint8Array, password: unknown) =>
  copyEncryption(new Uint8Array(plain), new Uint8Array(original), typeof password === 'string' ? password : '')
)

/** Digital signatures: the user's certificates, signing with one, and whether Windows trusts a signer. */
ipcMain.handle('sign:certs', () => listCertificates())
ipcMain.handle('sign:pfx-info', (_e, data: Uint8Array, password: unknown) => pfxInfo(new Uint8Array(data), typeof password === 'string' ? password : ''))
ipcMain.handle('sign:cms', (_e, data: Uint8Array, source: SignSource) => {
  if (!source || (source.kind !== 'store' && source.kind !== 'pfx')) throw new Error('Invalid certificate')
  return signCms(new Uint8Array(data), source.kind === 'pfx' ? { kind: 'pfx', data: new Uint8Array(source.data), password: typeof source.password === 'string' ? source.password : '' } : source)
})
ipcMain.handle('sign:timestamp', async (_e, url: unknown, request: Uint8Array) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('The time-stamp server address must start with http:// or https://')
  const res = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body: Buffer.from(request), signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`The time-stamp server answered ${res.status}.`)
  return new Uint8Array(await res.arrayBuffer())
})
ipcMain.handle('sign:chain', (_e, certs: Uint8Array[]) => chainStatus(Array.isArray(certs) ? certs.map((c) => new Uint8Array(c)) : []))

/** An installed font matching a PDF font name, for redrawing edited text in the same typeface. */
ipcMain.handle('font:find', async (_e, name: unknown, bold: unknown, italic: unknown) => {
  if (typeof name !== 'string' || name.length > 200) return null
  return findFont(name, bold === true, italic === true)
})

/** Rewrites a PDF through qpdf (object streams, recompression, unused resources, linearising). */
ipcMain.handle('pdf:qpdf', async (_e, data: Uint8Array, o: Record<string, unknown>) =>
  runQpdf(new Uint8Array(data), {
    objectStreams: o.objectStreams === true,
    recompress: o.recompress === true,
    removeUnusedResources: o.removeUnusedResources === true,
    linearise: o.linearise === true
  })
)

/** Saves an embedded file under a name the user picks. Any file type; nothing is opened or run. */
ipcMain.handle('file:save-attachment', async (e, name: string, data: Uint8Array) => {
  // Characters Windows does not allow in file names, including control characters.
  // eslint-disable-next-line no-control-regex
  const safe = basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'attachment'
  let target: string | undefined
  if (e2e && process.env.OPENPDF_E2E_DIR) target = join(process.env.OPENPDF_E2E_DIR, safe)
  else {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { defaultPath: safe }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    target = res.filePath
  }
  const tmp = `${target}.openpdf-tmp`
  await writeFile(tmp, data)
  await rename(tmp, target)
  return target
})

/** Asks for a folder, then writes each file into it without overwriting: a clash gets " (2)" and so on. */
ipcMain.handle('file:save-many', async (e, files: { name: string; data: Uint8Array }[]) => {
  let dir = e2e ? process.env.OPENPDF_E2E_DIR : undefined
  if (!dir) {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    dir = res.filePaths[0]
  }
  const written: string[] = []
  for (const f of files) {
    const stem = f.name.replace(/\.pdf$/i, '')
    let target = join(dir, `${stem}.pdf`)
    for (let n = 2; await readFile(target).then(() => true, () => false); n++) target = join(dir, `${stem} (${n}).pdf`)
    await writePdf(target, f.data)
    written.push(target)
  }
  return { dir, written }
})

/** Asks for a folder and writes files of any type into it (page pictures), never overwriting: a clash gets " (2)". */
ipcMain.handle('file:save-files', async (e, files: { name: string; data: Uint8Array }[]) => {
  let dir = e2e ? process.env.OPENPDF_E2E_DIR : undefined
  if (!dir) {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    dir = res.filePaths[0]
  }
  const written: string[] = []
  for (const f of files) {
    // eslint-disable-next-line no-control-regex
    const safe = basename(f.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'file'
    const dot = safe.lastIndexOf('.')
    const stem = dot > 0 ? safe.slice(0, dot) : safe
    const ext = dot > 0 ? safe.slice(dot) : ''
    let target = join(dir, safe)
    for (let n = 2; await readFile(target).then(() => true, () => false); n++) target = join(dir, `${stem} (${n})${ext}`)
    await writeFile(`${target}.openpdf-tmp`, f.data)
    await rename(`${target}.openpdf-tmp`, target)
    written.push(target)
  }
  return { dir, written }
})

// ---- Printing ---------------------------------------------------------------------------------------
// The renderer sends one PNG per page (rendered by PDFium at print resolution); they are spooled to a temporary
// folder so neither process holds the whole document. A hidden window lays them out one per sheet and prints.
const printJobs = new Map<string, { dir: string; sizes: { w: number; h: number }[] }>()

ipcMain.handle('print:begin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openpdf-print-'))
  const id = basename(dir)
  printJobs.set(id, { dir, sizes: [] })
  return id
})

ipcMain.handle('print:page', async (_e, id: string, n: number, png: Uint8Array, w: number, h: number) => {
  const job = printJobs.get(id)
  if (!job || !Number.isInteger(n) || n < 0) throw new Error('Unknown print job')
  await writeFile(join(job.dir, `${n}.png`), png)
  job.sizes[n] = { w, h }
})

async function endJob(id: string) {
  const job = printJobs.get(id)
  printJobs.delete(id)
  if (job) await rm(job.dir, { recursive: true, force: true })
}

ipcMain.handle('print:cancel', (_e, id: string) => endJob(id))

/** One sheet per page. Fit: scale to the printable area keeping proportions. Actual size: the page's own size in points. */
function printHtml(sizes: { w: number; h: number }[], fit: boolean, layout: PrintLayout): string {
  const { cols, rows } = sheetGrid(layout)
  // Several pages per side are always fitted to their cell; actual size only applies to one page per sheet.
  const actual = !fit && layout.kind === 'single'
  const cell = (n: number | null) => {
    if (n === null) return '<div class="cell"></div>'
    const s = sizes[n]
    const style = actual ? ` style="width:${s.w}pt;height:${s.h}pt;max-width:none;max-height:none"` : ''
    return `<div class="cell"><img src="${n}.png"${style}></div>`
  }
  const sheets = sheetSlots(sizes.length, layout)
    .map((slots) => `<div class="sheet">${slots.map(cell).join('')}</div>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${actual ? '@page { margin: 0 }' : ''}
html, body { margin: 0; padding: 0; background: #fff }
.sheet { width: 100vw; height: 100vh; display: grid; grid-template-columns: repeat(${cols}, 1fr); grid-template-rows: repeat(${rows}, 1fr); gap: ${cols > 1 ? '2vw' : '0'}; overflow: hidden; break-after: page }
.sheet:last-child { break-after: auto }
.cell { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; overflow: hidden }
img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain }
</style></head><body>${sheets}</body></html>`
}

ipcMain.handle('print:run', async (e, id: string, opts: { copies: number; fit: boolean; count: number; layout?: PrintLayout }) => {
  const layout: PrintLayout = opts.layout ?? { kind: 'single' }
  const { landscape } = sheetGrid(layout)
  const job = printJobs.get(id)
  if (!job) throw new Error('Unknown print job')
  const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined
  const win = new BrowserWindow({
    show: false,
    parent,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  })
  try {
    const html = join(job.dir, 'print.html')
    await writeFile(html, printHtml(job.sizes.slice(0, opts.count), opts.fit, layout))
    await win.loadFile(html) // resolves once the page and its images have loaded
    const margins = { marginType: opts.fit ? ('printableArea' as const) : ('none' as const) }
    // Test hook: write what would be printed to a PDF instead of showing the system print dialog.
    if (e2e && process.env.OPENPDF_E2E_PRINT) {
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4',
        landscape,
        // Inches. A quarter inch stands in for a printer's unprintable edge when fitting.
        margins: opts.fit ? { top: 0.25, bottom: 0.25, left: 0.25, right: 0.25 } : { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true
      })
      await writeFile(process.env.OPENPDF_E2E_PRINT, pdf)
      return { ok: true, pdfPath: process.env.OPENPDF_E2E_PRINT }
    }
    return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      win.webContents.print(
        {
          silent: false,
          printBackground: true,
          copies: Math.max(1, Math.min(999, Math.round(opts.copies))),
          margins,
          landscape,
          // Booklets are printed on both sides and folded along the short edge.
          ...(layout.kind === 'booklet' ? { duplexMode: 'shortEdge' as const } : {})
        },
        (ok, reason) => resolve(ok ? { ok } : { ok, error: reason === 'cancelled' ? undefined : reason })
      )
    })
  } finally {
    win.destroy()
    await endJob(id)
  }
})

// PDF paths passed on the command line (e.g. file association or `openpdf a.pdf b.pdf`).
ipcMain.handle('file:initial', async () => {
  const files = await Promise.all(pdfArgs(process.argv).map((p) => openForUser(resolve(p)).catch(() => null)))
  return files.filter((f) => f !== null)
})

/** What a command-line batch run is doing, for the hidden window that does the work to ask about. */
let cliJob: { steps: BatchAction['steps']; inputs: string[]; recursive: boolean; outDir: string | null; suffix: string } | null = null
let cliReport: string | null = null
const say = (text: string) => {
  try {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
  } catch {
    // no console to write to (a Windows program started from a window): the report file is the record
  }
}

ipcMain.handle('cli:job', () => cliJob)
ipcMain.handle('cli:done', async (_e, results: { source: string; ok: boolean; output?: string; error?: string; notes?: string[] }[]) => {
  const failed = results.filter((r) => !r.ok).length
  for (const r of results) say(r.ok ? `ok      ${r.source} -> ${r.output}${r.notes?.length ? ` (${r.notes.join('; ')})` : ''}` : `FAILED  ${r.source}: ${r.error}`)
  say(`${results.length - failed} of ${results.length} file${results.length === 1 ? '' : 's'} processed${failed ? `, ${failed} failed` : ''}.`)
  if (cliReport) await writeFile(cliReport, JSON.stringify({ processed: results.length - failed, failed, results }, null, 2)).catch(() => undefined)
  app.exit(results.length === 0 ? 1 : failed ? 1 : 0)
})

async function runCli(c: NonNullable<typeof cli>): Promise<void> {
  if (c.kind === 'help') {
    say(HELP)
    return app.exit(0)
  }
  if (c.kind === 'error') {
    say(`${c.message}\n\n${HELP}`)
    return app.exit(2)
  }
  if (c.kind === 'list') {
    const actions = await listActions()
    say(actions.length ? actions.map((a) => `${a.name}  (${a.steps.length} step${a.steps.length === 1 ? '' : 's'})`).join('\n') : 'There are no saved actions.')
    return app.exit(0)
  }
  try {
    const action = await loadAction(c.action, await listActions())
    const problems = checkStepsMain(action.steps)
    if (problems) throw new Error(problems)
    cliJob = { steps: action.steps, inputs: c.inputs.map((i) => resolve(i)), recursive: c.recursive, outDir: c.out ? resolve(c.out) : null, suffix: c.suffix }
    cliReport = c.report ? resolve(c.report) : null
  } catch (e) {
    say(e instanceof Error ? e.message : String(e))
    return app.exit(2)
  }
  const win = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  win.webContents.on('render-process-gone', () => {
    say('The batch run stopped unexpectedly.')
    app.exit(3)
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?cli=1`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { cli: '1' } })
}

/** The same checks the Batch dialog makes, without importing renderer code: a step list must exist and end well. */
function checkStepsMain(steps: unknown[]): string | null {
  if (!Array.isArray(steps) || !steps.length) return 'The action has no steps.'
  const sec = steps.findIndex((x) => (x as { kind?: string })?.kind === 'security')
  if (sec >= 0 && sec !== steps.length - 1) return 'Adding a password must be the last step.'
  return null
}

app.whenReady().then(async () => {
  await loadSettings() // applies the theme before the window paints
  Menu.setApplicationMenu(null) // the ribbon replaces Electron's default File/Edit/View/Window menu
  if (cli) return runCli(cli)
  createWindow()
  // Only when turned on, and only the request for the feed file.
  const u = (await loadSettings()).updates
  if (u.check && u.feed && !e2e) void checkForUpdates(u.feed)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
