/**
 * Bookmark tools on the tree as plain data: cut, copy and paste (also into another document), the pages a bookmark
 * covers (to extract or print them), and a check for bookmarks that point nowhere.
 */
import { insertAfter, nodeAt, removeAt, type BookmarkNode, type Path } from './outlineEdit'

const copyNode = (n: BookmarkNode): BookmarkNode => ({ ...n, children: n.children.map(copyNode) })

/** What is on the bookmark clipboard: shared by every document open in the program. */
let clip: BookmarkNode[] | null = null

export const hasBookmarkClip = (): boolean => clip !== null && clip.length > 0
export const setBookmarkClip = (nodes: BookmarkNode[] | null): void => {
  clip = nodes ? nodes.map(copyNode) : null
}
export const getBookmarkClip = (): BookmarkNode[] => (clip ?? []).map(copyNode)

/** The bookmark at `path` (with its children) as a copy, or null. */
export function copyAt(tree: BookmarkNode[], path: Path): BookmarkNode | null {
  const n = nodeAt(tree, path)
  return n ? copyNode(n) : null
}

/** Removes the bookmark at `path` and returns it as well. */
export function cutAt(tree: BookmarkNode[], path: Path): { tree: BookmarkNode[]; node: BookmarkNode } | null {
  const node = copyAt(tree, path)
  return node ? { tree: removeAt(tree, path), node } : null
}

/**
 * Puts copies of `nodes` after the bookmark at `path` (at the end of the top level when `path` is null). Pages the
 * document does not have are dropped from the pasted bookmarks (they stay, pointing nowhere, and the check finds them).
 */
export function pasteAfter(tree: BookmarkNode[], path: Path | null, nodes: BookmarkNode[], pageCount: number): { tree: BookmarkNode[]; path: Path } {
  const fix = (n: BookmarkNode): BookmarkNode => ({ ...n, page: n.page >= pageCount ? -1 : n.page, children: n.children.map(fix) })
  let t = tree
  let at: Path = path ?? []
  for (const n of nodes.map(fix)) {
    const r = insertAfter(t, at, n)
    t = r.tree
    at = r.path
  }
  return { tree: t, path: at }
}

/** The tree's bookmarks in the order they read, each with its depth and path. */
export function flatten(tree: BookmarkNode[]): { node: BookmarkNode; depth: number; path: Path }[] {
  const out: { node: BookmarkNode; depth: number; path: Path }[] = []
  const walk = (list: BookmarkNode[], base: Path) =>
    list.forEach((node, i) => {
      const path = [...base, i]
      out.push({ node, depth: base.length, path })
      walk(node.children, path)
    })
  walk(tree, [])
  return out
}

/**
 * The pages a bookmark covers: from its own page to the page before the next bookmark of the same or a higher level
 * (a bookmark on the same page covers just that page), or to the last page. 0-based and inclusive; null when the
 * bookmark has no page.
 */
export function bookmarkPages(tree: BookmarkNode[], path: Path, pageCount: number): { first: number; last: number } | null {
  const all = flatten(tree)
  const at = all.findIndex((x) => x.path.length === path.length && x.path.every((v, i) => v === path[i]))
  if (at < 0) return null
  const me = all[at]
  if (me.node.page < 0 || me.node.page >= pageCount) return null
  let last = pageCount - 1
  for (const x of all.slice(at + 1)) {
    if (x.depth <= me.depth && x.node.page >= 0) {
      last = x.node.page > me.node.page ? x.node.page - 1 : me.node.page
      break
    }
  }
  return { first: me.node.page, last: Math.max(me.node.page, Math.min(last, pageCount - 1)) }
}

export interface BrokenBookmark {
  path: Path
  title: string
  reason: 'no-destination' | 'page-missing' | 'name-missing'
}

/**
 * Bookmarks that lead nowhere: no destination at all, a page the document does not have, or a named destination that
 * is not defined. `names` is the set of defined named destinations (null when not known: names are then not checked).
 */
export function findBrokenBookmarks(tree: BookmarkNode[], pageCount: number, names: ReadonlySet<string> | null): BrokenBookmark[] {
  const out: BrokenBookmark[] = []
  for (const { node, path } of flatten(tree)) {
    const title = node.title || '(untitled)'
    if (node.named) {
      if (names && !names.has(node.named)) out.push({ path, title, reason: 'name-missing' })
    } else if (node.page < 0) out.push({ path, title, reason: 'no-destination' })
    else if (node.page >= pageCount) out.push({ path, title, reason: 'page-missing' })
  }
  return out
}

/** Removes the bookmarks at these paths (deepest and last first, so the other paths stay right). */
export function removeMany(tree: BookmarkNode[], paths: Path[]): BookmarkNode[] {
  const order = [...paths].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i] - a[i]
    return b.length - a.length
  })
  let t = tree
  for (const p of order) if (nodeAt(t, p)) t = removeAt(t, p)
  return t
}
