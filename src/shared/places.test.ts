import { describe, expect, it } from 'vitest'
import { parseSyncEngines, uniquePlaces } from './places'

const REG = String.raw`HKEY_CURRENT_USER\Software\SyncEngines\Providers\OneDrive
    DisplayNameResource    REG_SZ    @C:\Program Files\Microsoft OneDrive\FileSync.Resources.dll,-1006
    Version    REG_SZ    1

HKEY_CURRENT_USER\Software\SyncEngines\Providers\OneDrive\#temp
    MountPoint    REG_SZ    C:\Users\sam\OneDriveCloudTemp
    UrlNamespace    REG_SZ

HKEY_CURRENT_USER\Software\SyncEngines\Providers\OneDrive\03faf
    MountPoint    REG_SZ    C:\Users\sam\Contoso1\Tenders - Documents
    UrlNamespace    REG_SZ    https://contoso.sharepoint.com/sites/Tenders/Shared Documents/
    LibraryType    REG_SZ    teamsite
    WebUrl    REG_SZ    https://contoso.sharepoint.com/sites/Tenders

HKEY_CURRENT_USER\Software\SyncEngines\Providers\OneDrive\abc
    MountPoint    REG_SZ    C:\Users\sam\OneDrive - Example Constructions
    UrlNamespace    REG_SZ    https://contoso-my.sharepoint.com/personal/sam_contoso_com_au/Documents
    LibraryType    REG_SZ    business1
`

describe('parseSyncEngines', () => {
  it('finds synced SharePoint libraries and OneDrive folders, and skips entries with no web address', () => {
    expect(parseSyncEngines(REG)).toEqual([
      { kind: 'sharepoint', label: 'Tenders - Documents (SharePoint: Tenders)', path: 'C:\\Users\\sam\\Contoso1\\Tenders - Documents' },
      { kind: 'onedrive', label: 'OneDrive - Example Constructions (OneDrive)', path: 'C:\\Users\\sam\\OneDrive - Example Constructions' }
    ])
  })
  it('returns nothing for empty or unrelated text', () => {
    expect(parseSyncEngines('')).toEqual([])
    expect(parseSyncEngines('ERROR: The system was unable to find the specified registry key or value.')).toEqual([])
  })
})

describe('uniquePlaces', () => {
  it('keeps the first of places with the same path, ignoring case and a trailing slash', () => {
    const a = { kind: 'onedrive' as const, label: 'A', path: 'C:\\Users\\Sam\\OneDrive' }
    expect(uniquePlaces([a, { ...a, label: 'B', path: 'c:\\users\\sam\\onedrive\\' }, { ...a, label: 'C', path: 'D:\\x' }]).map((p) => p.label)).toEqual(['A', 'C'])
  })
})
