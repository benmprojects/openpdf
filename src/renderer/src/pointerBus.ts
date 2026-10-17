/**
 * A tiny publish and subscribe channel for where the pointer is over the pages. The viewer publishes on every mouse
 * move; only the status-bar readout listens, so the document view itself does not re-render for each move.
 */
export interface PagePointer {
  page: number
  /** Points from the top-left of the page as displayed (after view rotation). */
  u: number
  v: number
}

export interface PointerBus {
  emit(p: PagePointer | null): void
  subscribe(cb: (p: PagePointer | null) => void): () => void
}

export function createPointerBus(): PointerBus {
  const listeners = new Set<(p: PagePointer | null) => void>()
  return {
    emit: (p) => listeners.forEach((l) => l(p)),
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
