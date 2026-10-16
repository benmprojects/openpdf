/** How printed pages are placed on sheets of paper. Shared by the renderer (dialog) and main (layout). */
export type PrintLayout =
  | { kind: 'single' }
  /** Several pages per sheet, in rows from the top left. */
  | {
      kind: 'nup'
      perSheet: 2 | 4 | 6 | 9 | 16
      /** across (rows from the left, the default) or down (columns from the top). */
      order?: 'across' | 'down'
      /** Draw a thin border around each page. */
      border?: boolean
    }
  /**
   * Two pages per side, ordered so the printed stack folds into a booklet (print double-sided, flip on short edge).
   * `binding` is the side the spine is on (default left); `sides` limits the output to the fronts or the backs of
   * the sheets, for printing the two halves in separate passes on a single-sided printer.
   */
  | { kind: 'booklet'; binding?: 'left' | 'right'; sides?: 'both' | 'front' | 'back' }

/** Columns and rows of the grid on one side of a sheet, and whether the sheet should be landscape. */
export function sheetGrid(layout: PrintLayout): { cols: number; rows: number; landscape: boolean } {
  if (layout.kind === 'booklet') return { cols: 2, rows: 1, landscape: true }
  if (layout.kind === 'single') return { cols: 1, rows: 1, landscape: false }
  switch (layout.perSheet) {
    case 2:
      return { cols: 2, rows: 1, landscape: true }
    case 4:
      return { cols: 2, rows: 2, landscape: false }
    case 6:
      return { cols: 2, rows: 3, landscape: false }
    case 9:
      return { cols: 3, rows: 3, landscape: false }
    default:
      return { cols: 4, rows: 4, landscape: false }
  }
}

/**
 * The page (an index into the printed list) in each slot of each sheet side, or null for a blank slot.
 * Booklets pad the page count to a multiple of four with blanks at the end.
 */
export function sheetSlots(count: number, layout: PrintLayout): (number | null)[][] {
  if (layout.kind === 'single') return Array.from({ length: count }, (_, i) => [i])
  if (layout.kind === 'nup') {
    const out: (number | null)[][] = []
    for (let i = 0; i < count; i += layout.perSheet) {
      out.push(
        Array.from({ length: layout.perSheet }, (_, slot) => {
          let k = slot
          if (layout.order === 'down') {
            // Slots run across the rows; the page that belongs in a slot when filling column by column.
            const { cols, rows } = sheetGrid(layout)
            k = (slot % cols) * rows + Math.floor(slot / cols)
          }
          return i + k < count ? i + k : null
        })
      )
    }
    return out
  }
  const n = Math.ceil(count / 4) * 4
  const page = (i: number) => (i < count ? i : null)
  const out: (number | null)[][] = []
  for (let s = 0; s < n / 4; s++) {
    out.push([page(n - 1 - 2 * s), page(2 * s)]) // front: outer pages
    out.push([page(2 * s + 1), page(n - 2 - 2 * s)]) // back: inner pages
  }
  // A right-hand spine puts every pair the other way round.
  const bound = layout.binding === 'right' ? out.map((side) => [side[1], side[0]]) : out
  if (layout.sides === 'front') return bound.filter((_, i) => i % 2 === 0)
  if (layout.sides === 'back') return bound.filter((_, i) => i % 2 === 1)
  return bound
}
