import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { sheetGrid, sheetSlots, type PrintLayout } from '../shared/printLayout'
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
if (!e2e && !app.requestSingleInstanceLock()) app.quit()

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

ipcMain.handle('file:open-dialog', async () => {
  if (e2e && process.env.OPENPDF_E2E_OPEN) return Promise.all(process.env.OPENPDF_E2E_OPEN.split(';').map(readPdf))
  const res = await dialog.showOpenDialog({
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

app.whenReady().then(async () => {
  await loadSettings() // applies the theme before the window paints
  Menu.setApplicationMenu(null) // the ribbon replaces Electron's default File/Edit/View/Window menu
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
