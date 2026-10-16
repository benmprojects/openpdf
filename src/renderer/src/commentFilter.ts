import type { Annot, AnnotKind } from './annotations'

/** Which comments a Comments import or export covers. */
export interface CommentFilter {
  by: 'all' | 'pages' | 'type' | 'author'
  /** 0-based pages (by 'pages'). */
  pages: number[]
  kinds: AnnotKind[]
  /** Compared without regard to case; '' stands for comments with no author. */
  authors: string[]
}

export const NO_FILTER: CommentFilter = { by: 'all', pages: [], kinds: [], authors: [] }

/** Kinds that count as comments (links and other tools' annotations are not offered). */
export const COMMENT_KINDS: AnnotKind[] = ['note', 'highlight', 'underline', 'strikeout', 'squiggly', 'caret', 'textbox', 'typewriter', 'callout', 'line', 'arrow', 'rectangle', 'ellipse', 'ink', 'polygon', 'polyline', 'cloud', 'stamp', 'fileattach', 'sound']

export const authorOf = (a: Annot) => (a.author ?? '').trim()

export function applyFilter<T extends Pick<Annot, 'page' | 'kind' | 'author'>>(list: T[], f: CommentFilter): T[] {
  switch (f.by) {
    case 'all':
      return list
    case 'pages': {
      const s = new Set(f.pages)
      return list.filter((a) => s.has(a.page))
    }
    case 'type': {
      const s = new Set(f.kinds)
      return list.filter((a) => s.has(a.kind))
    }
    case 'author': {
      const s = new Set(f.authors.map((x) => x.trim().toLowerCase()))
      return list.filter((a) => s.has((a.author ?? '').trim().toLowerCase()))
    }
  }
}
