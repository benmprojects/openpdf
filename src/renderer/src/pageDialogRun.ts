import { expandPattern, pagesWord, type PageDialogResult } from './pageDialogLogic'
import { insertWithOptions } from './insertOptions'
import { joinPages } from './pageMerge'
import { deletePages, duplicatePages, extractPages, insertBlankPages, insertMany, movePages, replacePages, rotatePages, splitByRanges, splitBySize, swapPages } from './pageOps'

/** Runs a dialog's result that changes this document's bytes. Extract, split and a merge into a new document are not these. */
export async function applyDialogEdit(r: PageDialogResult, base: Uint8Array): Promise<Uint8Array> {
  switch (r.kind) {
    case 'insert':
      if (r.blank) return insertBlankPages(base, r.at, r.blank.count, r.blank)
      return (r.keep ? await insertWithOptions(base, r.at, r.items, r.keep) : await insertMany(base, r.at, r.items)).bytes
    case 'merge':
      return (await insertMany(base, r.at, r.items)).bytes
    case 'delete':
      return deletePages(base, r.pages)
    case 'rotate':
      return rotatePages(base, r.pages, r.delta)
    case 'replace':
      return replacePages(base, r.pages, r.other.data, r.theirs)
    case 'duplicate':
      return duplicatePages(base, r.pages, r.copies, r.where)
    case 'move':
      return movePages(base, r.pages, r.before)
    case 'swap':
      return swapPages(base, r.a, r.b)
    case 'join':
      return (await joinPages(base, r.pages, r.mode, r.reversed)).bytes
    default:
      throw new Error('This operation does not change the document.')
  }
}

/** The message shown after a dialog's edit is done. */
export function doneMessage(r: PageDialogResult): string | undefined {
  switch (r.kind) {
    case 'insert':
      return `Inserted ${pagesWord(r.blank ? r.blank.count : r.count)}`
    case 'merge':
      return `Merged ${pagesWord(r.count)}`
    case 'delete':
      return `Deleted ${pagesWord(r.pages.length)}`
    case 'rotate':
      return `Rotated ${pagesWord(r.pages.length)}`
    case 'replace':
      return `Replaced ${pagesWord(r.pages.length)} with ${r.theirs.length} from ${r.other.name}`
    case 'duplicate':
      return `Added ${pagesWord(r.pages.length * r.copies)}`
    case 'move':
      return `Moved ${pagesWord(r.pages.length)}`
    case 'swap':
      return `Swapped page ${r.a + 1} and page ${r.b + 1}`
    case 'join':
      return `Joined ${pagesWord(r.pages.length - (r.pages.length % 2))} into ${pagesWord(Math.floor(r.pages.length / 2))}`
    default:
      return undefined
  }
}

/** The files a split makes, named from the pattern. */
export async function buildSplitFiles(r: Extract<PageDialogResult, { kind: 'split' }>, src: Uint8Array, name: string): Promise<{ name: string; data: Uint8Array }[]> {
  const parts = r.mode === 'size' ? await splitBySize(src, parseFloat(r.value.replace(',', '.')) * 1024 * 1024) : await splitByRanges(src, r.ranges ?? [])
  return parts.map((p, i) => ({ name: expandPattern(r.pattern, { name, first: p.first, last: p.last, n: i + 1, total: parts.length, title: p.title }), data: p.bytes }))
}

/** One file per extracted page, named from the pattern. */
export async function buildExtractFiles(src: Uint8Array, pages: number[], pattern: string, name: string): Promise<{ name: string; data: Uint8Array }[]> {
  const out: { name: string; data: Uint8Array }[] = []
  for (const [i, p] of pages.entries()) out.push({ name: expandPattern(pattern, { name, first: p + 1, last: p + 1, n: i + 1, total: pages.length }), data: await extractPages(src, [p]) })
  return out
}
