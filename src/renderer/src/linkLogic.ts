/**
 * Links beyond a web address or a page: opening a file, running JavaScript and going to a named destination. This holds
 * the pure parts: what an action is, whether it may be written, how it reads back from a file, and how web addresses are
 * found in text so that they can be turned into links.
 */
import { PDFDict, PDFHexString, PDFName, PDFString, type PDFObject } from 'pdf-lib'
import { launchBlockReason } from '../../shared/launchPath'
import { codeOf } from './docScripts'

export type LinkAction = { kind: 'file'; path: string } | { kind: 'js'; code: string } | { kind: 'named'; name: string }

export const MAX_LINK_SCRIPT = 20000

/** A reason the action cannot be written, or null. */
export function checkLinkAction(a: LinkAction): string | null {
  if (a.kind === 'file') return launchBlockReason(a.path)
  if (a.kind === 'js') {
    if (!a.code.trim()) return 'Enter the JavaScript to run.'
    if (a.code.length > MAX_LINK_SCRIPT) return 'The script is too long.'
    return null
  }
  if (!a.name.trim()) return 'Choose the named destination.'
  if (a.name.length > 255) return 'The destination name is too long.'
  return null
}

/** The action dictionary for a link annotation's /A. */
export function linkActionObject(a: LinkAction): Record<string, unknown> {
  if (a.kind === 'file') return { S: 'Launch', F: PDFString.of(a.path.trim().replace(/\\/g, '/')), NewWindow: true }
  if (a.kind === 'js') return { S: 'JavaScript', JS: PDFHexString.fromText(a.code) }
  return { S: 'GoTo', D: PDFString.of(a.name) }
}

const textOf = (o: PDFObject | undefined): string | undefined => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined)

/** The file an action's /F names: a string, or a file specification dictionary with /UF or /F. */
function fileOf(o: PDFObject | undefined): string | undefined {
  const direct = textOf(o)
  if (direct !== undefined) return direct
  if (o instanceof PDFDict) return textOf(o.lookup(PDFName.of('UF'))) ?? textOf(o.lookup(PDFName.of('F')))
  return undefined
}

/** What a link's action says, when it is one of the kinds above. Web addresses and page destinations are read elsewhere. */
export function linkActionOf(action: PDFDict | undefined): LinkAction | undefined {
  const s = action?.lookup(PDFName.of('S'))
  if (!action || !(s instanceof PDFName)) return undefined
  if (s.decodeText() === 'Launch') {
    const win = action.lookup(PDFName.of('Win'))
    const path = fileOf(action.lookup(PDFName.of('F'))) ?? (win instanceof PDFDict ? textOf(win.lookup(PDFName.of('F'))) : undefined)
    return path ? { kind: 'file', path } : undefined
  }
  if (s.decodeText() === 'JavaScript') {
    const code = codeOf(action)
    return code !== undefined ? { kind: 'js', code } : undefined
  }
  if (s.decodeText() === 'GoTo') {
    const d = action.lookup(PDFName.of('D'))
    const name = d instanceof PDFName ? d.decodeText() : textOf(d)
    return name ? { kind: 'named', name } : undefined
  }
  return undefined
}

export function describeLinkAction(a: LinkAction): string {
  if (a.kind === 'file') return `Open ${a.path}`
  if (a.kind === 'js') return 'Run JavaScript'
  return `Go to the destination "${a.name}"`
}

// ---- Web addresses in text -----------------------------------------------------------------------------

/** A web address starting with http(s):// or www., up to the next space or bracket. */
export const URL_PATTERN = String.raw`(?:https?:\/\/|www\.)[^\s<>"']+`

/** Drops trailing punctuation, and a closing bracket that has no opening one, from a web address found in text. */
export function trimUrlEnd(text: string): string {
  let s = text
  for (;;) {
    const last = s[s.length - 1]
    if (!last) return s
    if (/[.,;:!?'"]/.test(last)) s = s.slice(0, -1)
    else if (last === ')' && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) s = s.slice(0, -1)
    else if (last === ']' && (s.match(/\[/g)?.length ?? 0) < (s.match(/\]/g)?.length ?? 0)) s = s.slice(0, -1)
    else return s
  }
}

/** The address to link to for text found on a page: trailing punctuation dropped, `www.` given https://. Null if it is not one. */
export function webAddress(text: string): string | null {
  const s = trimUrlEnd(text.trim())
  if (!s) return null
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s)) return s
  const withScheme = /^www\./i.test(s) ? `https://${s}` : s
  try {
    const u = new URL(withScheme)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !/\.[a-z]{2,}$/i.test(u.hostname) || u.username || u.password) return null
    return withScheme
  } catch {
    return null
  }
}

export interface FoundUrl {
  from: number
  /** One past the last character. */
  end: number
  url: string
}

/** Web addresses in a string, with where they sit (the dropped trailing punctuation is not part of the range). */
export function findUrls(text: string): FoundUrl[] {
  const out: FoundUrl[] = []
  for (const m of text.matchAll(new RegExp(URL_PATTERN, 'gi'))) {
    const kept = trimUrlEnd(m[0])
    const url = webAddress(kept)
    if (url) out.push({ from: m.index, end: m.index + kept.length, url })
  }
  return out
}

/** Whether a link's target is a web or mail address (what "remove all web links" removes). */
export const isWebLink = (a: { linkUri?: string }): boolean => !!a.linkUri && /^(https?:|mailto:)/i.test(a.linkUri.trim())

// ---- The link dialog's draft ---------------------------------------------------------------------------

export type LinkTo = 'uri' | 'page' | 'file' | 'js' | 'named'

/** What the link dialog is editing: one field per kind of target, and which kind is chosen. */
export interface LinkDraft {
  page: number
  rect: { x: number; y: number; w: number; h: number }
  to: LinkTo
  uri: string
  /** The target page, counted from 1 (as typed). */
  page1: string
  file: string
  code: string
  named: string
  /** The annotation being edited; unset for a new link. */
  id?: number
}

export function newLinkDraft(page: number, rect: LinkDraft['rect'], pageCount: number): LinkDraft {
  return { page, rect, to: 'uri', uri: 'https://', page1: String(Math.min(pageCount, page + 2)), file: '', code: '', named: '' }
}

/** The draft for an existing link annotation. */
export function draftFromLink(a: { id: number; page: number; rects: LinkDraft['rect'][]; linkUri?: string; linkPage?: number; linkAction?: LinkAction }): LinkDraft {
  const d: LinkDraft = { id: a.id, page: a.page, rect: a.rects[0], to: 'uri', uri: a.linkUri ?? 'https://', page1: String((a.linkPage ?? 0) + 1), file: '', code: '', named: '' }
  if (a.linkAction?.kind === 'file') return { ...d, to: 'file', file: a.linkAction.path }
  if (a.linkAction?.kind === 'js') return { ...d, to: 'js', code: a.linkAction.code }
  if (a.linkAction?.kind === 'named') return { ...d, to: 'named', named: a.linkAction.name }
  return { ...d, to: a.linkUri !== undefined ? 'uri' : 'page' }
}

/** What the draft sets on the annotation, or the reason it cannot be saved. */
export function targetFromDraft(d: LinkDraft, pageCount: number): { ok: true; target: { linkUri?: string; linkPage?: number; linkAction?: LinkAction } } | { ok: false; error: string } {
  if (d.to === 'page') {
    const p = Number(d.page1) - 1
    if (!(Number.isInteger(p) && p >= 0 && p < pageCount)) return { ok: false, error: `Enter a page from 1 to ${pageCount}.` }
    return { ok: true, target: { linkPage: p } }
  }
  if (d.to === 'uri') {
    if (!/^(https?:\/\/\S+\.\S+|mailto:\S+@\S+)$/i.test(d.uri.trim())) return { ok: false, error: 'Enter a web address starting with https:// (or a mailto: address).' }
    return { ok: true, target: { linkUri: d.uri.trim() } }
  }
  const action: LinkAction = d.to === 'file' ? { kind: 'file', path: d.file.trim() } : d.to === 'js' ? { kind: 'js', code: d.code } : { kind: 'named', name: d.named.trim() }
  const problem = checkLinkAction(action)
  return problem ? { ok: false, error: problem } : { ok: true, target: { linkAction: action } }
}
