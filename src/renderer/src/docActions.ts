/**
 * Document actions: JavaScript that runs when the document is opened (the catalogue's /OpenAction), when it is about to
 * close or save or print, and after it was saved or printed (the catalogue's /AA entries WC, WS, DS, WP and DP, ISO 32000
 * 12.6.3 table 197). They run in the same sandbox as field scripts. A file's own open action that goes to a page is kept:
 * the script is chained to it with /Next.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, type PDFObject } from 'pdf-lib'
import { codeOf } from './docScripts'

export const DOC_EVENTS = ['open', 'willClose', 'willSave', 'didSave', 'willPrint', 'didPrint'] as const
export type DocEvent = (typeof DOC_EVENTS)[number]
export type DocActions = Record<DocEvent, string>

export const EMPTY_DOC_ACTIONS: DocActions = { open: '', willClose: '', willSave: '', didSave: '', willPrint: '', didPrint: '' }

/** The /AA key of each event (the open action is not in /AA). */
const AA_KEY: Record<Exclude<DocEvent, 'open'>, string> = { willClose: 'WC', willSave: 'WS', didSave: 'DS', willPrint: 'WP', didPrint: 'DP' }

const N = PDFName.of

/** The JavaScript in an action or the chain of actions after it. */
function scriptInChain(action: PDFObject | undefined, depth = 0): string | undefined {
  if (!(action instanceof PDFDict) || depth > 8) return undefined
  const here = codeOf(action)
  if (here !== undefined) return here
  const next = action.lookup(N('Next'))
  if (next instanceof PDFArray) {
    for (let i = 0; i < next.size(); i++) {
      const c = scriptInChain(next.lookup(i), depth + 1)
      if (c !== undefined) return c
    }
    return undefined
  }
  return scriptInChain(next, depth + 1)
}

export function docActionsOf(doc: PDFDocument): DocActions {
  const out = { ...EMPTY_DOC_ACTIONS }
  out.open = scriptInChain(doc.catalog.lookup(N('OpenAction'))) ?? ''
  const aa = doc.catalog.lookupMaybe(N('AA'), PDFDict)
  if (aa) for (const [ev, key] of Object.entries(AA_KEY)) out[ev as keyof typeof AA_KEY] = scriptInChain(aa.lookup(N(key))) ?? ''
  return out
}

export async function readDocActions(bytes: Uint8Array): Promise<DocActions> {
  return docActionsOf(await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true }))
}

/** The actions and the page count, read together (the page count is what `this.numPages` says to a script). */
export async function readDocActionState(bytes: Uint8Array): Promise<{ actions: DocActions; pageCount: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  return { actions: docActionsOf(doc), pageCount: doc.getPageCount() }
}

export const hasDocActions = (a: DocActions): boolean => DOC_EVENTS.some((e) => a[e].trim() !== '')

/** Chains `script` after an action, replacing any JavaScript already in the chain. */
function chain(doc: PDFDocument, action: PDFDict, script: string): void {
  const js = doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(script) })
  const keep: PDFObject[] = []
  const old = action.lookup(N('Next'))
  const items: (PDFObject | undefined)[] = old instanceof PDFArray ? Array.from({ length: old.size() }, (_, i) => old.lookup(i)) : [old]
  for (const it of items) if (it && !(it instanceof PDFDict && codeOf(it) !== undefined)) keep.push(it)
  if (!script) {
    if (keep.length) action.set(N('Next'), keep.length === 1 ? keep[0] : doc.context.obj(keep as never))
    else action.delete(N('Next'))
    return
  }
  keep.push(js)
  action.set(N('Next'), keep.length === 1 ? js : doc.context.obj(keep as never))
}

/** Writes the six scripts (an empty one removes that action). Returns the new file. */
export async function writeDocActions(bytes: Uint8Array, a: DocActions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const cat = doc.catalog

  // The open action.
  const script = a.open.trim() ? a.open : ''
  const oa = cat.lookup(N('OpenAction'))
  if (!oa) {
    if (script) cat.set(N('OpenAction'), ctx.obj({ S: 'JavaScript', JS: PDFHexString.fromText(script) }))
  } else if (oa instanceof PDFArray) {
    // A destination: keep it as a GoTo action and chain the script after it.
    if (script) {
      const goto = ctx.obj({ S: 'GoTo', D: oa })
      chain(doc, goto, script)
      cat.set(N('OpenAction'), goto)
    }
  } else if (oa instanceof PDFDict) {
    if (codeOf(oa) !== undefined) {
      if (script) oa.set(N('JS'), PDFHexString.fromText(script))
      else if (oa.lookup(N('Next'))) {
        // Something follows the script: keep the rest of the chain.
        const next = oa.lookup(N('Next'))
        const first = next instanceof PDFArray ? next.get(0) : next
        if (first) cat.set(N('OpenAction'), first)
        else cat.delete(N('OpenAction'))
      } else cat.delete(N('OpenAction'))
    } else chain(doc, oa, script)
  }

  // The others.
  let aa = cat.lookupMaybe(N('AA'), PDFDict)
  for (const [ev, key] of Object.entries(AA_KEY)) {
    const code = a[ev as keyof typeof AA_KEY].trim() ? a[ev as keyof typeof AA_KEY] : ''
    if (code) {
      if (!aa) {
        aa = ctx.obj({}) as PDFDict
        cat.set(N('AA'), aa)
      }
      const existing = aa.lookup(N(key))
      if (existing instanceof PDFDict && codeOf(existing) !== undefined) existing.set(N('JS'), PDFHexString.fromText(code))
      else aa.set(N(key), ctx.obj({ S: 'JavaScript', JS: PDFHexString.fromText(code) }))
    } else if (aa) {
      const existing = aa.lookup(N(key))
      if (existing instanceof PDFDict && codeOf(existing) !== undefined) aa.delete(N(key))
    }
  }
  if (aa && !aa.keys().length) cat.delete(N('AA'))
  return doc.save({ updateFieldAppearances: false })
}
