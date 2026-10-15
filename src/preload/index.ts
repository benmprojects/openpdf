import { contextBridge, ipcRenderer } from 'electron'

export interface OpenedFile {
  name: string
  path: string
  data: Uint8Array
}

const api = {
  openFileDialog: (): Promise<OpenedFile[]> => ipcRenderer.invoke('file:open-dialog'),
  initialFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('file:initial'),
  readFile: (path: string): Promise<OpenedFile> => ipcRenderer.invoke('file:read', path)
}

contextBridge.exposeInMainWorld('openpdf', api)
export type OpenPdfApi = typeof api
