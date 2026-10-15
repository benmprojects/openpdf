import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: resolve('src/renderer'),
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    worker: { format: 'es' },
    plugins: [react()]
  }
})
