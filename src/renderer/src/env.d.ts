/// <reference types="vite/client" />
import type { OpenPdfApi } from '../../preload'

declare global {
  interface Window {
    openpdf: OpenPdfApi
  }
}
