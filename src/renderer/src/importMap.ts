import { defaultColor, pdfDateToIso, REVIEW_STATES, type Annot, type Reply, type ReviewState } from './annotations'
import type { ImportedAnnot, ImportedReply } from './pdfClient'

/**
 * One page's annotations from the PDFium worker as ours, with each one's replies attached. `nextId` hands out
 * fresh ids. Used when opening a document and when reading another copy to compare comments.
 */
export function annotsFromImported(page: number, list: ImportedAnnot[], replies: ImportedReply[], nextId: () => number): Annot[] {
  return list.map((r) => ({
    id: nextId(),
    page,
    kind: r.kind,
    color: r.color ?? defaultColor(r.kind),
    rects: r.rects,
    text: r.text,
    fontSize: r.fontSize,
    lineWidth: r.lineWidth,
    points: r.points,
    fill: r.fill,
    dash: r.dash,
    measure: r.measure,
    stampInfo: r.stampInfo,
    opacity: r.opacity,
    fontFamily: r.fontFamily,
    author: r.author,
    created: r.created ? pdfDateToIso(r.created) : undefined,
    modified: r.modified ? pdfDateToIso(r.modified) : undefined,
    replies: replies
      .filter((x) => x.parent === r.index)
      .map(
        (x): Reply => ({
          id: nextId(),
          author: x.author,
          text: x.text,
          date: pdfDateToIso(x.date) ?? new Date(0).toISOString(),
          state: REVIEW_STATES.includes(x.state as ReviewState) ? (x.state as ReviewState) : undefined,
          origin: { index: x.index, subtype: 1, rect: x.rect }
        })
      )
      .sort((p, q) => p.date.localeCompare(q.date)),
    origin: { index: r.index, subtype: r.subtype, rect: r.rect }
  }))
}
