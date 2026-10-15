/** Pages copied with Copy pages: a small PDF of them, shared by every open document. */
let clip: { bytes: Uint8Array; count: number; from: string } | null = null
const listeners = new Set<() => void>()

export function setPageClip(c: { bytes: Uint8Array; count: number; from: string }): void {
  clip = c
  listeners.forEach((l) => l())
}

export function getPageClip(): typeof clip {
  return clip
}

/** Calls `fn` whenever the clipboard changes; returns an unsubscribe. */
export function onPageClip(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
