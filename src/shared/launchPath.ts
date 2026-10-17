/**
 * Which files a link in a document may open. A link can name any file on the computer, so nothing is opened without
 * asking, and programs and scripts are never opened at all, whatever the link says. Pure, so both processes can use it.
 */

/** Extensions that run code (programs, scripts, installers, shortcuts, macro-enabled Office files and the like). */
const RUNNABLE = new Set([
  'exe', 'com', 'scr', 'pif', 'bat', 'cmd', 'msi', 'msp', 'mst', 'msc', 'lnk', 'url', 'reg', 'inf', 'cpl', 'dll', 'sys', 'ocx',
  'ps1', 'ps1xml', 'psm1', 'psd1', 'psc1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'hta', 'jar', 'jnlp', 'gadget',
  'appref-ms', 'application', 'sh', 'command', 'app', 'scf', 'settingcontent-ms', 'chm', 'iqy', 'slk', 'xll', 'wll',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm', 'py', 'pyw', 'rb', 'pl'
])

/** The lower-case extension of the last part of a path, or ''. */
export function extensionOf(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? ''
  const dot = last.lastIndexOf('.')
  return dot > 0 || (dot === 0 && last.length > 1) ? last.slice(dot + 1).toLowerCase() : ''
}

/** Why a link's file may not be opened, or null when it may be offered to the user. */
export function launchBlockReason(path: string): string | null {
  const p = path.trim()
  if (!p) return 'The link has no file name.'
  if (p.length > 500) return 'The file name is too long.'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(p)) return 'The file name contains characters that are not allowed.'
  if (/^[a-z][a-z0-9+.-]+:/i.test(p) && !/^[a-z]:[\\/]/i.test(p)) return 'Only files on this computer can be opened from a link, not web addresses or other kinds of link.'
  if (p.startsWith('\\\\') || p.startsWith('//')) return 'Files on a network share are not opened from a link.'
  if (/:/.test(p.replace(/^[a-z]:/i, ''))) return 'The file name contains a stream name that is not allowed.'
  if (/[. ]$/.test(p)) return 'The file name ends in a space or a full stop.'
  const ext = extensionOf(p)
  if (!ext) return 'Only files with a known type are opened from a link.'
  if (RUNNABLE.has(ext)) return `Files of this type (.${ext}) can run programs, so they are never opened from a link.`
  return null
}
