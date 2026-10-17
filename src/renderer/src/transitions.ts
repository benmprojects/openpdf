/**
 * Page transitions and automatic advance for presentation mode. The PDF's own /Trans and /Dur entries on each page
 * (ISO 32000-1 12.4.4) are read and mapped to the few effects the presentation draws: fade, push, wipe and zoom.
 */
import { PDFDict, PDFDocument, PDFName, PDFNumber, type PDFObject } from 'pdf-lib'
import type { TransitionChoice } from '../../shared/prefs'

export type Effect = 'none' | 'fade' | 'push' | 'wipe' | 'zoom'

export interface PageTransition {
  effect: Effect
  /** Seconds the effect takes. */
  seconds: number
  /** The page's own /Dur: seconds to show it before moving on, or null. */
  display: number | null
}

/** How each PDF transition style is drawn here (anything unknown is a plain replace). */
export function effectForStyle(style: string): Effect {
  switch (style) {
    case 'Fade':
    case 'Dissolve':
    case 'Glitter':
      return 'fade'
    case 'Wipe':
    case 'Split':
    case 'Blinds':
    case 'Box':
      return 'wipe'
    case 'Push':
    case 'Cover':
    case 'Uncover':
    case 'Fly':
      return 'push'
    default:
      return 'none'
  }
}

const num = (o: PDFObject | undefined): number | null => (o instanceof PDFNumber ? o.asNumber() : null)

/** The transition and display time set on each page of a file, by page index; pages with neither are left out. */
export async function readPageTransitions(bytes: Uint8Array): Promise<Map<number, PageTransition>> {
  const out = new Map<number, PageTransition>()
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  doc.getPages().forEach((page, i) => {
    const trans = page.node.lookup(PDFName.of('Trans'))
    const dur = num(page.node.lookup(PDFName.of('Dur')))
    if (!(trans instanceof PDFDict) && dur === null) return
    let effect: Effect = 'none'
    let seconds = 1
    if (trans instanceof PDFDict) {
      const s = trans.lookup(PDFName.of('S'))
      effect = effectForStyle(s instanceof PDFName ? s.decodeText() : 'R')
      seconds = num(trans.lookup(PDFName.of('D'))) ?? 1
    }
    out.set(i, { effect, seconds: Math.min(3, Math.max(0.1, seconds)), display: dur !== null && dur > 0 ? Math.min(3600, dur) : null })
  })
  return out
}

/** The effect and duration to use when moving to `page`, from the viewer's choice and the document's settings. */
export function transitionFor(choice: TransitionChoice, page: number, fromFile: Map<number, PageTransition> | null): { effect: Effect; seconds: number } {
  if (choice === 'document') {
    const t = fromFile?.get(page)
    return { effect: t?.effect ?? 'none', seconds: t?.seconds ?? 1 }
  }
  return { effect: choice, seconds: 0.45 }
}

/** Web Animations keyframes for an effect; `dir` is 1 moving forward and -1 moving back. */
export function keyframesFor(effect: Effect, dir: 1 | -1): Keyframe[] {
  switch (effect) {
    case 'fade':
      return [{ opacity: 0 }, { opacity: 1 }]
    case 'push':
      return [{ transform: `translateX(${dir * 100}%)` }, { transform: 'translateX(0)' }]
    case 'wipe':
      return [{ clipPath: dir === 1 ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }]
    case 'zoom':
      return [
        { transform: 'scale(0.8)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 }
      ]
    default:
      return []
  }
}

/** The page after moving `dir` from `page`; wraps when looping, and is null at an end otherwise. */
export function stepPage(page: number, count: number, dir: 1 | -1, loop: boolean): number | null {
  const next = page + dir
  if (next >= 0 && next < count) return next
  if (!loop || count < 1) return null
  return dir === 1 ? 0 : count - 1
}

/**
 * Seconds to wait before the next page on its own: the page's own display time when the transitions come from the
 * document and it has one, else the chosen interval; null when nothing advances automatically.
 */
export function advanceDelay(choice: TransitionChoice, seconds: number, page: number, fromFile: Map<number, PageTransition> | null): number | null {
  if (choice === 'document') {
    const own = fromFile?.get(page)?.display
    if (own) return own
  }
  return seconds > 0 ? seconds : null
}
