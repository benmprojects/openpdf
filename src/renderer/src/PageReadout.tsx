import { useEffect, useState } from 'react'
import { displayDims, type Rotation } from './viewRotation'
import type { PageSize } from './pdfClient'
import type { PointerBus, PagePointer } from './pointerBus'
import { formatPageSize, formatPosition, paperName, type ReadoutUnit } from './viewTools'
import { t } from './i18n'

/**
 * The status bar's page size and pointer position. It has its own state and listens to the viewer's pointer bus, so
 * moving the pointer over the pages re-renders only this small component.
 */
export function PageReadout({ bus, pages, page, rotation, unit }: { bus: PointerBus; pages: PageSize[]; page: number; rotation: Rotation; unit: ReadoutUnit }) {
  const [at, setAt] = useState<PagePointer | null>(null)
  useEffect(() => bus.subscribe(setAt), [bus])
  const shownPage = at ? at.page : page
  const size = pages[shownPage]
  if (!size) return null
  const d = displayDims(size, rotation)
  const paper = paperName(d.width, d.height)
  return (
    <span className="readout muted" role="status" aria-label={t('Page size and position')}>
      <span className="readout-size" title={t('Size of page {n}', { n: shownPage + 1 })}>
        {formatPageSize(d.width, d.height, unit)}
        {paper ? ` (${paper})` : ''}
      </span>
      {at && <span className="readout-pos">{formatPosition(at.u, at.v, unit)}</span>}
    </span>
  )
}
