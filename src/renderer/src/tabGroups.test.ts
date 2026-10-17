import { describe, expect, it } from 'vitest'
import { addToGroup, freshGroupName, idsToClose, moveTab, nextGroupColour, nextGroupId, pruneGroups, removeFromGroup, shownTabs, GROUP_COLOURS, type TabGroup, type TabLike } from './tabGroups'

const tabs = (...spec: [number, number?][]): TabLike[] => spec.map(([id, group]) => (group === undefined ? { id } : { id, group }))
const order = (t: TabLike[]) => t.map((x) => x.id)
const g = (id: number, collapsed = false): TabGroup => ({ id, name: `G${id}`, colour: GROUP_COLOURS[0], collapsed })

describe('addToGroup', () => {
  it('starts a group where its first tab was', () => {
    const out = addToGroup(tabs([1], [2], [3], [4]), [3], 1)
    expect(order(out)).toEqual([1, 2, 3, 4])
    expect(out[2].group).toBe(1)
  })
  it('gathers new members next to the group', () => {
    const out = addToGroup(tabs([1, 1], [2], [3], [4, 1]), [2, 3], 1)
    expect(order(out)).toEqual([1, 4, 2, 3])
    expect(out.map((t) => t.group)).toEqual([1, 1, 1, 1])
  })
  it('ignores ids that are not tabs', () => {
    const t = tabs([1])
    expect(addToGroup(t, [9], 1)).toBe(t)
  })
})

describe('removeFromGroup and pruneGroups', () => {
  it('takes a tab out and drops groups left empty', () => {
    const out = removeFromGroup(tabs([1, 1], [2, 1], [3, 2]), 3)
    expect(out[2]).toEqual({ id: 3 })
    expect(pruneGroups(out, [g(1), g(2)]).map((x) => x.id)).toEqual([1])
  })
})

describe('moveTab', () => {
  it('moves before another tab or to the end', () => {
    expect(order(moveTab(tabs([1], [2], [3]), 3, 1))).toEqual([3, 1, 2])
    expect(order(moveTab(tabs([1], [2], [3]), 1, null))).toEqual([2, 3, 1])
  })
  it('joins a group when dropped inside it and leaves it when dropped outside', () => {
    const inside = moveTab(tabs([1, 1], [2, 1], [3]), 3, 2)
    expect(inside.find((t) => t.id === 3)?.group).toBe(1)
    const outside = moveTab(tabs([1, 1], [2, 1], [3]), 1, null)
    expect(outside.find((t) => t.id === 1)?.group).toBeUndefined()
  })
  it('keeps the group when reordered within it', () => {
    const out = moveTab(tabs([1, 1], [2, 1], [3, 1]), 3, 1)
    expect(order(out)).toEqual([3, 1, 2])
    expect(out.every((t) => t.group === 1)).toBe(true)
  })
  it('does nothing for an unknown tab', () => {
    const t = tabs([1], [2])
    expect(moveTab(t, 9, 1)).toBe(t)
    expect(moveTab(t, 1, 9)).toBe(t)
  })
})

describe('shownTabs', () => {
  it('hides the tabs of a collapsed group except the one in front', () => {
    const t = tabs([1, 1], [2, 1], [3])
    expect(order(shownTabs(t, [g(1, true)], null))).toEqual([3])
    expect(order(shownTabs(t, [g(1, true)], 2))).toEqual([2, 3])
    expect(order(shownTabs(t, [g(1)], null))).toEqual([1, 2, 3])
  })
})

describe('idsToClose', () => {
  const t = tabs([1], [2], [3], [4])
  it('covers the chosen side', () => {
    expect(idsToClose(t, 2, 'others')).toEqual([1, 3, 4])
    expect(idsToClose(t, 2, 'right')).toEqual([3, 4])
    expect(idsToClose(t, 2, 'left')).toEqual([1])
    expect(idsToClose(t, 2, 'all')).toEqual([1, 2, 3, 4])
    expect(idsToClose(t, 9, 'all')).toEqual([])
  })
})

describe('names and colours', () => {
  it('finds the next free ones', () => {
    expect(freshGroupName([{ ...g(1), name: 'Group 1' }], 'Group')).toBe('Group 2')
    expect(nextGroupId([g(1), g(4)])).toBe(5)
    expect(nextGroupColour([{ ...g(1), colour: GROUP_COLOURS[0] }])).toBe(GROUP_COLOURS[1])
  })
})
