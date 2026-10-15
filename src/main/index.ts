import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
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
