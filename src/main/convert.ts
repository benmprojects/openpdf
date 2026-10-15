/**
 * Conversions that need the main process: web pages to PDF (Chromium's own print engine, with scripts and network
 * requests off), Office files to PDF through an installed LibreOffice, and a screenshot of the screen.
 */
import { BrowserWindow, desktopCapturer, screen } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface HtmlSource {
  /** A local .html or .htm file; its images and styles beside it load. */
  path?: string
  /** Or the markup itself. */
  html?: string
}

/**
 * Prints a web page to PDF. Scripts are off and only local files and data: addresses load, so converting a saved page
 * never phones home or runs the page's code.
 */
export async function htmlToPdf(src: HtmlSource): Promise<Uint8Array> {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, partition: `convert-${Date.now()}` } })
  try {
    win.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !/^(file|data|blob):/i.test(details.url) }))
    if (src.path) await win.loadURL(pathToFileURL(src.path).toString())
    else await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(src.html ?? '')}`)
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } })
    return new Uint8Array(pdf)
  } finally {
    win.destroy()
  }
}

/** Where LibreOffice's command-line tool is, or null when it is not installed. */
export function findLibreOffice(): string | null {
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Programs')].filter((x): x is string => !!x)
  for (const r of roots) {
    const p = join(r, 'LibreOffice', 'program', 'soffice.exe')
    if (existsSync(p)) return p
  }
  return null
}

const OFFICE_EXT = new Set(['.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.csv', '.txt'])

/** Converts a Word, Excel, PowerPoint or OpenDocument file to PDF with LibreOffice, when it is installed. */
export async function officeToPdf(path: string): Promise<Uint8Array> {
  const exe = findLibreOffice()
  if (!exe) throw new Error('LibreOffice is not installed, so Word, Excel and PowerPoint files cannot be converted. Install it from libreoffice.org, or save the file as PDF from its own program.')
  if (!OFFICE_EXT.has(extname(path).toLowerCase())) throw new Error('That kind of file cannot be converted.')
  const dir = await mkdtemp(join(tmpdir(), 'openpdf-office-'))
  try {
    // A private profile folder, so a running copy of LibreOffice does not get in the way.
    const profile = pathToFileURL(join(dir, 'profile')).toString()
    await new Promise<void>((resolve, reject) => {
      execFile(exe, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, path], { windowsHide: true, timeout: 180000 }, (err) => (err ? reject(new Error('LibreOffice could not convert that file.')) : resolve()))
    })
    return new Uint8Array(await readFile(join(dir, `${basename(path, extname(path))}.pdf`)))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** A PNG of the whole primary screen, taken after the window is hidden for a moment. */
export async function screenshot(win: BrowserWindow | null): Promise<Uint8Array | null> {
  const wasVisible = !!win && win.isVisible() && !win.isMinimized()
  if (win && wasVisible) win.minimize()
  await new Promise((r) => setTimeout(r, 600))
  try {
    const d = screen.getPrimaryDisplay()
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0]
    return src ? new Uint8Array(src.thumbnail.toPNG()) : null
  } finally {
    if (win && wasVisible) {
      win.restore()
      win.focus()
    }
  }
}
