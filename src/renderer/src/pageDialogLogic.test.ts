import { describe, expect, it } from 'vitest'
import { blankPageSize, compactRanges, expandPattern, initialRange, insertIndex, moveTarget, patternProblem, planSplit, parseSourceRange, resolveRange, type DocContext } from './pageDialogLogic'

const sizes = [
  { width: 100, height: 200 },
  { width: 300, height: 200 },
  { width: 100, height: 200 },
  { width: 300, height: 200 },
  { width: 100, height: 200 }
]
const ctx: DocContext = { count: 5, current: 2, selected: [1, 3], sizes }

describe('resolveRange', () => {
  it('resolves every preset', () => {
    const r = (preset: Parameters<typeof resolveRange>[0]['preset'], custom = '') => resolveRange({ preset, custom }, ctx)
    expect(r('all').pages).toEqual([0, 1, 2, 3, 4])
    expect(r('current').pages).toEqual([2])
    expect(r('selected').pages).toEqual([1, 3])
    expect(r('odd').pages).toEqual([0, 2, 4])
    expect(r('even').pages).toEqual([1, 3])
    expect(r('landscape').pages).toEqual([1, 3])
    expect(r('portrait').pages).toEqual([0, 2, 4])
    expect(r('custom', '1-2, 5').pages).toEqual([0, 1, 4])
  })
  it('explains an empty result', () => {
    expect(resolveRange({ preset: 'selected', custom: '' }, { ...ctx, selected: [] }).error).toMatch(/No pages are selected/)
    expect(resolveRange({ preset: 'landscape', custom: '' }, { ...ctx, sizes: [sizes[0]], count: 1, current: 0 }).error).toMatch(/no landscape/)
    expect(resolveRange({ preset: 'custom', custom: '9' }, ctx).error).toMatch(/outside pages 1 to 5/)
    expect(resolveRange({ preset: 'custom', custom: '' }, ctx).error).toMatch(/at least one page/)
  })
  it('starts from the selection, else the current page', () => {
    expect(initialRange(ctx)).toEqual({ preset: 'selected', custom: '2, 4' })
    expect(initialRange({ ...ctx, selected: [] })).toEqual({ preset: 'current', custom: '3' })
  })
})

describe('compactRanges and source ranges', () => {
  it('compacts', () => expect(compactRanges([0, 1, 2, 4])).toBe('1-3, 5'))
  it('treats empty source text as every page', () => {
    expect(parseSourceRange('', 4)).toEqual({ pages: null, error: null })
    expect(parseSourceRange('2-3', 4).pages).toEqual([1, 2])
    expect(parseSourceRange('7', 4).error).toMatch(/outside/)
  })
})

describe('insertIndex', () => {
  it('works out the position', () => {
    expect(insertIndex({ side: 'before', target: 'first', page: 1 }, 7)).toMatchObject({ index: 0, text: 'before page 1' })
    expect(insertIndex({ side: 'after', target: 'first', page: 1 }, 7).index).toBe(1)
    expect(insertIndex({ side: 'after', target: 'last', page: 1 }, 7)).toMatchObject({ index: 7, text: 'after page 7' })
    expect(insertIndex({ side: 'before', target: 'last', page: 1 }, 7).index).toBe(6)
    expect(insertIndex({ side: 'after', target: 'page', page: 3 }, 7).index).toBe(3)
    expect(insertIndex({ side: 'before', target: 'page', page: 3 }, 7).index).toBe(2)
  })
  it('rejects a page outside the document', () => {
    expect(insertIndex({ side: 'after', target: 'page', page: 8 }, 7).error).toMatch(/1 to 7/)
    expect(insertIndex({ side: 'after', target: 'page', page: Number.NaN }, 7).error).not.toBeNull()
  })
})

describe('blankPageSize', () => {
  const none = { w: 0, h: 0 }
  it('copies the current page or uses paper sizes', () => {
    expect(blankPageSize('same', 'portrait', { width: 300, height: 200 }, none)).toEqual({ width: 300, height: 200, error: null })
    const a4 = blankPageSize('a4', 'portrait', undefined, none)
    expect(Math.round(a4.width)).toBe(595)
    expect(Math.round(a4.height)).toBe(842)
    const land = blankPageSize('a4', 'landscape', undefined, none)
    expect(Math.round(land.width)).toBe(842)
    const letter = blankPageSize('letter', 'portrait', undefined, none)
    expect(Math.round(letter.width)).toBe(612)
    expect(Math.round(letter.height)).toBe(792)
  })
  it('validates custom sizes', () => {
    expect(blankPageSize('custom', 'portrait', undefined, { w: 0, h: 100 }).error).not.toBeNull()
    expect(blankPageSize('custom', 'landscape', undefined, { w: 100, h: 200 }).width).toBeGreaterThan(blankPageSize('custom', 'landscape', undefined, { w: 100, h: 200 }).height)
    expect(blankPageSize('same', 'portrait', undefined, none).error).not.toBeNull()
  })
})

describe('file names', () => {
  const v = { name: 'Plan', first: 2, last: 4, n: 3, total: 12 }
  it('expands tokens', () => {
    expect(expandPattern('{name} - {n}', v)).toBe('Plan - 03.pdf')
    expect(expandPattern('{name} (pages {first}-{last}).pdf', v)).toBe('Plan (pages 2-4).pdf')
    expect(expandPattern('{name} - {label}', v)).toBe('Plan - pages 2-4.pdf')
    expect(expandPattern('{name} - {label}', { ...v, title: 'Intro' })).toBe('Plan - Intro.pdf')
    expect(expandPattern('{name} - {label}', { ...v, first: 5, last: 5 })).toBe('Plan - page 5.pdf')
  })
  it('removes characters Windows rejects', () => expect(expandPattern('a/b:{title}', { ...v, title: 'x?y' })).toBe('a_b_x_y.pdf'))
  it('needs a distinguishing token for several files', () => {
    expect(patternProblem('{name}', 3)).toMatch(/Add \{n\}/)
    expect(patternProblem('{name}', 1)).toBeNull()
    expect(patternProblem('{name} {n}', 3)).toBeNull()
    expect(patternProblem('  ', 1)).not.toBeNull()
  })
})

describe('planSplit', () => {
  it('splits every N pages', () => {
    expect(planSplit('count', '2', 5, []).ranges).toEqual([{ first: 1, last: 2 }, { first: 3, last: 4 }, { first: 5, last: 5 }])
    expect(planSplit('count', '0', 5, []).error).not.toBeNull()
  })
  it('splits at chosen pages', () => {
    expect(planSplit('at', '4, 2', 5, []).ranges).toEqual([{ first: 1, last: 1 }, { first: 2, last: 3 }, { first: 4, last: 5 }])
    expect(planSplit('at', '1', 5, []).error).toMatch(/2 to 5/)
    expect(planSplit('at', '', 5, []).error).not.toBeNull()
  })
  it('splits by bookmarks and by size', () => {
    expect(planSplit('bookmarks', '', 6, [{ title: 'A', page: 0 }, { title: 'B', page: 3 }]).ranges).toEqual([{ first: 1, last: 3, title: 'A' }, { first: 4, last: 6, title: 'B' }])
    expect(planSplit('bookmarks', '', 6, []).error).not.toBeNull()
    expect(planSplit('size', '5', 6, [])).toEqual({ ranges: null, error: null })
    expect(planSplit('size', 'x', 6, []).error).not.toBeNull()
  })
})

describe('moveTarget', () => {
  it('finds the before index', () => {
    expect(moveTarget({ kind: 'start' }, [3], 5)).toEqual({ before: 0, error: null })
    expect(moveTarget({ kind: 'end' }, [0], 5)).toEqual({ before: 5, error: null })
    expect(moveTarget({ kind: 'before', page: 2 }, [3], 5).before).toBe(1)
    expect(moveTarget({ kind: 'after', page: 2 }, [3], 5).before).toBe(2)
  })
  it('rejects impossible and pointless moves', () => {
    expect(moveTarget({ kind: 'after', page: 4 }, [3], 5).error).toMatch(/being moved/)
    expect(moveTarget({ kind: 'after', page: 9 }, [3], 5).error).toMatch(/1 to 5/)
    expect(moveTarget({ kind: 'start' }, [0, 1], 5).error).toMatch(/already/)
    expect(moveTarget({ kind: 'after', page: 1 }, [1], 5).error).toMatch(/already/)
  })
})
