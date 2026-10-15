/**
 * Cloud "places": folders that a sync client keeps in step with OneDrive, SharePoint, Google Drive or Dropbox. They are
 * ordinary folders on this computer, so opening and saving through them works with every dialog; this just finds them
 * so they can be offered as shortcuts. Pure parsing here; the registry and disk are read in the main process.
 */

export type PlaceKind = 'onedrive' | 'sharepoint' | 'googledrive' | 'dropbox'

export interface Place {
  kind: PlaceKind
  /** Shown to the person: "Tenders - Documents (SharePoint: Tenders)". */
  label: string
  path: string
}

const lastSegment = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

/**
 * Reads `reg query HKCU\Software\SyncEngines\Providers\OneDrive /s`: one block per synced library, each with its
 * MountPoint. Entries without a web address (temporary stores) are skipped.
 */
export function parseSyncEngines(text: string): Place[] {
  const out: Place[] = []
  let block: Record<string, string> | null = null
  const flush = () => {
    if (!block?.MountPoint) return
    const web = block.WebUrl || block.UrlNamespace
    if (!web) return
    const isSite = /sharepoint\.com\/(sites|teams)\//i.test(web) || block.LibraryType === 'teamsite' || block.LibraryType === 'documentLibrary'
    const site = /\/(?:sites|teams)\/([^/]+)/i.exec(web)?.[1]
    out.push({
      kind: isSite ? 'sharepoint' : 'onedrive',
      label: isSite ? `${lastSegment(block.MountPoint)} (SharePoint${site ? `: ${decodeURIComponent(site)}` : ''})` : `${lastSegment(block.MountPoint)} (OneDrive)`,
      path: block.MountPoint
    })
  }
  for (const raw of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw.trim())) {
      flush()
      block = {}
      continue
    }
    const m = /^\s+(\S+)\s+REG_\w+\s*(.*)$/.exec(raw)
    if (m && block) block[m[1]] = m[2].trim()
  }
  flush()
  return out
}

/** Drops places with the same path (compared without regard to case or a trailing slash), keeping the first. */
export function uniquePlaces(places: Place[]): Place[] {
  const seen = new Set<string>()
  return places.filter((p) => {
    const k = p.path.replace(/[\\/]+$/, '').toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
