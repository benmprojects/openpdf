import { contextBridge, ipcRenderer } from 'electron'

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
  /** Printing: start a job, send each page as a PNG with its size in points, then print (shows the system dialog). */
  printBegin: (): Promise<string> => ipcRenderer.invoke('print:begin'),
  printPage: (job: string, n: number, png: Uint8Array, w: number, h: number): Promise<void> =>
    ipcRenderer.invoke('print:page', job, n, png, w, h),
  printRun: (job: string, opts: { copies: number; fit: boolean; count: number }): Promise<{ ok: boolean; error?: string; pdfPath?: string }> =>
    ipcRenderer.invoke('print:run', job, opts),
  printCancel: (job: string): Promise<void> => ipcRenderer.invoke('print:cancel', job)
}

contextBridge.exposeInMainWorld('openpdf', api)
export type OpenPdfApi = typeof api
