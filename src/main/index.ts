import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // The renderer blocks unload while a tab has unsaved annotations; ask before discarding them.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Close and discard', 'Keep open'],
      defaultId: 1,
      cancelId: 1,
      message: 'Some documents have unsaved annotations.',
      detail: 'Closing now discards them.'
    })
    if (choice === 0) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

async function readPdf(path: string) {
  const data = await readFile(path)
  return { name: basename(path), path, data: new Uint8Array(data) }
}

ipcMain.handle('file:open-dialog', async () => {
  const res = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  })
  if (res.canceled) return []
  return Promise.all(res.filePaths.map(readPdf))
})

ipcMain.handle('file:read', (_e, path: string) => readPdf(path))

/** Writes to a temporary file first so a failed write cannot leave a half-written PDF behind. */
async function writePdf(path: string, data: Uint8Array) {
  if (!path.toLowerCase().endsWith('.pdf')) throw new Error('Only .pdf files can be saved.')
  const tmp = `${path}.openpdf-tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
  return { name: basename(path), path }
}

ipcMain.handle('file:save', (_e, path: string, data: Uint8Array) => writePdf(path, data))

ipcMain.handle('file:save-as', async (e, suggestedName: string, data: Uint8Array) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { defaultPath: suggestedName, filters: [{ name: 'PDF documents', extensions: ['pdf'] }] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  return writePdf(res.filePath, data)
})

/** Asks for a folder, then writes each file into it without overwriting: a clash gets " (2)" and so on. */
ipcMain.handle('file:save-many', async (e, files: { name: string; data: Uint8Array }[]) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  const dir = res.filePaths[0]
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

// PDF paths passed on the command line (e.g. file association or `openpdf a.pdf b.pdf`).
ipcMain.handle('file:initial', async () => {
  const paths = process.argv.slice(1).filter((a) => a.toLowerCase().endsWith('.pdf'))
  return Promise.all(paths.map(readPdf))
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
