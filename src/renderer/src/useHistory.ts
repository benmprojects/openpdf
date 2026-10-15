import { useCallback, useState } from 'react'

const MAX_UNDO = 100

/** Immutable undo/redo stack. `commit` records a new state; `reset` clears the history. */
export function useHistory<T>(initial: T) {
  const [s, setS] = useState({ past: [] as T[], present: initial, future: [] as T[] })

  const commit = useCallback((next: T | ((prev: T) => T)) => {
    setS((c) => {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(c.present) : next
      if (value === c.present) return c
      return { past: [...c.past.slice(-(MAX_UNDO - 1)), c.present], present: value, future: [] }
    })
  }, [])

  const undo = useCallback(
    () =>
      setS((c) =>
        c.past.length
          ? { past: c.past.slice(0, -1), present: c.past[c.past.length - 1], future: [c.present, ...c.future] }
          : c
      ),
    []
  )

  const redo = useCallback(
    () =>
      setS((c) =>
        c.future.length ? { past: [...c.past, c.present], present: c.future[0], future: c.future.slice(1) } : c
      ),
    []
  )

  const reset = useCallback((value: T) => setS({ past: [], present: value, future: [] }), [])

  return { present: s.present, canUndo: s.past.length > 0, canRedo: s.future.length > 0, commit, undo, redo, reset }
}
