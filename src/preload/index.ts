import { contextBridge, ipcRenderer } from 'electron'
import type { RecoveryEntry, Settings } from '../main/settings'

export type { RecoveryEntry, Settings }

export interface OpenedFile {
  name: string
  path: string
  data: Uint8Array
}

const api = {
  openFileDialog: (): Promise<OpenedFile[]> => ipcRenderer.invoke('file:open-dialog'),
  initialFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('file:initial'),
  readFile: (path: string): Promise<OpenedFile> => ipcRenderer.invoke('file:read', path),
  /** Overwrites the PDF at `path`. */
  saveFile: (path: string, data: Uint8Array): Promise<{ name: string; path: string }> =>
    ipcRenderer.invoke('file:save', path, data),
  /** Shows a Save dialog; resolves null if cancelled. */
  saveFileAs: (suggestedName: string, data: Uint8Array): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke('file:save-as', suggestedName, data),
  /** Asks for a folder and writes the files into it, never overwriting. Resolves null if cancelled. */
  saveMany: (files: { name: string; data: Uint8Array }[]): Promise<{ dir: string; written: string[] } | null> =>
    ipcRenderer.invoke('file:save-many', files),
  copyImage: (png: Uint8Array): Promise<void> => ipcRenderer.invoke('clipboard:write-image', png),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('file:pick-folder'),
  listPdfs: (dir: string, recursive: boolean): Promise<string[]> => ipcRenderer.invoke('file:list-pdfs', dir, recursive),
  /** Save As dialog for an embedded file; resolves to the written path, or null if cancelled. */
  saveAttachment: (name: string, data: Uint8Array): Promise<string | null> => ipcRenderer.invoke('file:save-attachment', name, data),
  /** Printing: start a job, send each page as a PNG with its size in points, then print (shows the system dialog). */
  printBegin: (): Promise<string> => ipcRenderer.invoke('print:begin'),
  printPage: (job: string, n: number, png: Uint8Array, w: number, h: number): Promise<void> =>
    ipcRenderer.invoke('print:page', job, n, png, w, h),
  printRun: (job: string, opts: { copies: number; fit: boolean; count: number }): Promise<{ ok: boolean; error?: string; pdfPath?: string }> =>
    ipcRenderer.invoke('print:run', job, opts),
  printCancel: (job: string): Promise<void> => ipcRenderer.invoke('print:cancel', job),
  /** Resolves null if the file is gone (it is then dropped from the recent list). */
  openRecent: (path: string): Promise<OpenedFile | null> => ipcRenderer.invoke('file:open-recent', path),
  /** Files opened from outside while the app runs (Explorer, file association). Returns an unsubscribe. */
  onOpenFiles: (cb: (files: OpenedFile[]) => void): (() => void) => {
    const h = (_e: unknown, files: OpenedFile[]) => cb(files)
    ipcRenderer.on('file:open-files', h)
    return () => ipcRenderer.removeListener('file:open-files', h)
  },
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
