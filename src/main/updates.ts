/**
 * Updates, opt in. Nothing is checked unless the person turns it on and gives an update address; nothing is sent
 * except the request for the feed file (no identifiers, no document information). The feed is the generic kind: a
 * `latest.yml` beside the installer, as electron-builder writes it. A downloaded installer is checked against the hash in
 * that file. Use an https address, and sign the installer, before relying on this: an unsigned installer from an
 * address an attacker can alter would not be protected.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { feedAllowed } from '../shared/updateFeed'

export interface UpdateSettings {
  /** Look for an update when the program starts. */
  check: boolean
  /** The address of the folder holding latest.yml; empty means no updates. */
  feed: string
}

export interface UpdateStatus {
  state: 'off' | 'unavailable' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  version?: string
  message?: string
  percent?: number
}

/** Whether this build carries its own update source (written by electron-builder from the `publish` setting). */
const hasBuiltInFeed = () => existsSync(join(process.resourcesPath, 'app-update.yml'))

let last: UpdateStatus = { state: 'off', current: app.getVersion() }
let configured = ''

function configure(feed: string): void {
  if (configured === feed) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  // An empty address means this program's own releases; an address means a feed folder with latest.yml.
  if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed })
  autoUpdater.on('download-progress', (p) => {
    last = { ...last, state: 'downloading', percent: Math.round(p.percent) }
  })
  autoUpdater.on('update-downloaded', () => {
    last = { ...last, state: 'ready', percent: 100 }
  })
  configured = feed
}

export const updateStatus = (): UpdateStatus => last

/** Asks the feed whether a newer version exists. */
export async function checkForUpdates(feed: string): Promise<UpdateStatus> {
  const current = app.getVersion()
  const custom = feed.trim()
  if (custom && !feedAllowed(custom)) return (last = { state: 'error', current, message: 'The update address must start with https:// (or be on this computer).' })
  if (!app.isPackaged) return (last = { state: 'unavailable', current, message: 'Updates can only be checked in the installed program.' })
  if (!custom && !hasBuiltInFeed()) return (last = { state: 'unavailable', current, message: 'This build has no update source of its own. Enter an update address.' })
  try {
    configure(custom)
    const r = await autoUpdater.checkForUpdates()
    const v = r?.updateInfo.version
    last = r && v && r.isUpdateAvailable ? { state: 'available', current, version: v } : { state: 'none', current }
  } catch (e) {
    last = { state: 'error', current, message: e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : 'The update check failed.' }
  }
  return last
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (last.state !== 'available') return last
  last = { ...last, state: 'downloading', percent: 0 }
  try {
    await autoUpdater.downloadUpdate()
    last = { ...last, state: 'ready', percent: 100 }
  } catch (e) {
    last = { state: 'error', current: app.getVersion(), message: e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : 'The download failed.' }
  }
  return last
}

/** Closes the program and runs the downloaded installer. */
export function installUpdate(): void {
  if (last.state === 'ready') autoUpdater.quitAndInstall()
}
