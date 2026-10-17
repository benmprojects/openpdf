/**
 * Pure logic for the document tab strip: groups (a name and a colour shared by neighbouring tabs), moving tabs, hiding the
 * tabs of a collapsed group, and which tabs a "close others" or "close to the right" command covers.
 */

export interface TabLike {
  id: number
  /** The group the tab belongs to, if any. */
  group?: number
}

export interface TabGroup {
  id: number
  name: string
  colour: string
  collapsed: boolean
}

export const GROUP_COLOURS = ['#c0392b', '#d97706', '#2f855a', '#2b6cb0', '#6b46c1', '#b83280', '#4a5568']

/** The colour for the next new group: the first not in use, else round the list. */
export function nextGroupColour(groups: TabGroup[]): string {
  return GROUP_COLOURS.find((c) => !groups.some((g) => g.colour === c)) ?? GROUP_COLOURS[groups.length % GROUP_COLOURS.length]
}

export function nextGroupId(groups: TabGroup[]): number {
  return groups.reduce((m, g) => Math.max(m, g.id), 0) + 1
}

/**
 * Puts `ids` in a group and keeps the group's tabs side by side: the moved tabs go after the group's last tab, or stay
 * where the first of them was when the group is new.
 */
export function addToGroup<T extends TabLike>(tabs: T[], ids: number[], group: number): T[] {
  const moving = tabs.filter((t) => ids.includes(t.id)).map((t) => ({ ...t, group }))
  if (!moving.length) return tabs
  const rest = tabs.filter((t) => !ids.includes(t.id))
  const lastMember = rest.reduce((at, t, i) => (t.group === group ? i : at), -1)
  const firstMovedAt = tabs.findIndex((t) => ids.includes(t.id))
  // Without members the group starts where the first moved tab was (counting only the tabs that stay in front of it).
  const at = lastMember >= 0 ? lastMember + 1 : tabs.slice(0, firstMovedAt).filter((t) => !ids.includes(t.id)).length
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)]
}

/** A copy of the tab in `group`, or out of any group when `group` is undefined. */
function withGroup<T extends TabLike>(tab: T, group: number | undefined): T {
  if (group !== undefined) return { ...tab, group }
  const copy = { ...tab }
  delete copy.group
  return copy
}

/** Takes a tab out of its group; it stays where it is in the strip. */
export function removeFromGroup<T extends TabLike>(tabs: T[], id: number): T[] {
  return tabs.map((t) => (t.id === id && t.group !== undefined ? withGroup(t, undefined) : t))
}

/** Groups that still have at least one tab. */
export function pruneGroups(tabs: TabLike[], groups: TabGroup[]): TabGroup[] {
  const used = new Set(tabs.map((t) => t.group))
  return groups.filter((g) => used.has(g.id))
}

/** Moves a tab to sit before another tab, or to the end when `beforeId` is null. A tab dropped in the middle of a group joins it. */
export function moveTab<T extends TabLike>(tabs: T[], id: number, beforeId: number | null): T[] {
  const moving = tabs.find((t) => t.id === id)
  if (!moving || id === beforeId) return tabs
  const rest = tabs.filter((t) => t.id !== id)
  const at = beforeId === null ? rest.length : rest.findIndex((t) => t.id === beforeId)
  if (at < 0) return tabs
  const before = rest[at - 1]
  const after = rest[at]
  // Dropped between two tabs of one group it joins that group; next to a tab of its own group it keeps it; otherwise it leaves its group.
  const group = before && after && before.group !== undefined && before.group === after.group ? before.group : moving.group !== undefined && (before?.group === moving.group || after?.group === moving.group) ? moving.group : undefined
  const placed = withGroup(moving, group)
  return [...rest.slice(0, at), placed, ...rest.slice(at)]
}

/** The tabs to draw: those of a collapsed group are hidden, except the one in front. */
export function shownTabs<T extends TabLike>(tabs: T[], groups: TabGroup[], activeId: number | null): T[] {
  const collapsed = new Set(groups.filter((g) => g.collapsed).map((g) => g.id))
  return tabs.filter((t) => t.group === undefined || !collapsed.has(t.group) || t.id === activeId)
}

export type CloseScope = 'others' | 'right' | 'left' | 'all'

/** The tabs a close command covers. */
export function idsToClose(tabs: TabLike[], id: number, scope: CloseScope): number[] {
  const at = tabs.findIndex((t) => t.id === id)
  if (at < 0) return []
  if (scope === 'all') return tabs.map((t) => t.id)
  if (scope === 'others') return tabs.filter((t) => t.id !== id).map((t) => t.id)
  if (scope === 'right') return tabs.slice(at + 1).map((t) => t.id)
  return tabs.slice(0, at).map((t) => t.id)
}

/** A name for a new group that is not used yet ("Group 1", "Group 2" and so on, in English; the caller translates the word). */
export function freshGroupName(groups: TabGroup[], word: string): string {
  for (let n = 1; ; n++) {
    const name = `${word} ${n}`
    if (!groups.some((g) => g.name === name)) return name
  }
}
