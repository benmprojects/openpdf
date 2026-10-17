import { describe, expect, it } from 'vitest'
import { extensionOf, launchBlockReason } from './launchPath'

describe('files a link may open', () => {
  it('allows ordinary documents', () => {
    for (const p of ['Specification.pdf', 'C:/Projects/plan.dwg', 'sub\\folder\\photo.JPG', '../report.docx', 'notes.txt', 'C:\\Data\\sheet.xlsx']) expect(launchBlockReason(p)).toBeNull()
  })

  it('never allows anything that runs code', () => {
    for (const p of ['setup.exe', 'run.BAT', 'x.cmd', 'a.ps1', 'a.vbs', 'a.js', 'a.hta', 'a.lnk', 'a.msi', 'a.scr', 'a.jar', 'macro.docm', 'macro.xlsm', 'a.reg', 'a.dll', 'link.url', 'help.chm']) {
      expect(launchBlockReason(p), p).toMatch(/never opened/)
    }
  })

  it('refuses web addresses, network shares and stream names', () => {
    expect(launchBlockReason('https://example.com/a.pdf')).not.toBeNull()
    expect(launchBlockReason('file:///C:/a.pdf')).not.toBeNull()
    expect(launchBlockReason('\\\\server\\share\\a.pdf')).not.toBeNull()
    expect(launchBlockReason('//server/share/a.pdf')).not.toBeNull()
    expect(launchBlockReason('a.pdf:hidden.exe')).not.toBeNull()
  })

  it('refuses names with no type, a trailing dot or space, control characters, or nothing at all', () => {
    expect(launchBlockReason('')).not.toBeNull()
    expect(launchBlockReason('README')).not.toBeNull()
    expect(launchBlockReason('a.exe.')).not.toBeNull()
    expect(launchBlockReason('a.pdf ')).toBeNull() // trimmed first
    expect(launchBlockReason('a\u0000.pdf')).not.toBeNull()
  })

  it('reads the extension of the last part only', () => {
    expect(extensionOf('C:\\a.b\\file')).toBe('')
    expect(extensionOf('x/y.TXT')).toBe('txt')
  })
})
