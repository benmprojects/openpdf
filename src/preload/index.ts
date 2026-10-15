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
    ipcRenderer.invoke('file:save-as', suggestedName, data)
}

contextBridge.exposeInMainWorld('openpdf', api)
export type OpenPdfApi = typeof api
