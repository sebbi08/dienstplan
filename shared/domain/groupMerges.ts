// Merging groups at the edge times („Gruppen zusammenlegen“, Anwesenheit): early and late, the children of several
// groups are in one room. A merge holds for one facility and day only, a group is in at most one merge at a time.

/** Whether the child is here right now: it arrived and has not left yet (an open stay of the day). */
export function presentNow(child: { stays: readonly { left: number | null }[] }): boolean {
  return child.stays.some(stay => stay.left === null)
}

/**
 * The children of a merged section: of `order` (the ids of all children of the merged groups, in the facility's child
 * order) those here right now, in that order. A child marked „Geht“ drops out, one not yet arrived is not in it.
 */
export function mergedPresent<T extends { childId: number; stays: readonly { left: number | null }[] }>(order: readonly number[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map(row => [row.childId, row]))
  return order.flatMap((childId) => {
    const row = byId.get(childId)
    return row && presentNow(row) ? [row] : []
  })
}

/** The wanted groups once each, in the order given. */
export function distinctGroups(groupIds: readonly number[]): number[] {
  return [...new Set(groupIds)]
}

/** The first of the wanted groups that is already in one of the day's active merges (each a list of group ids), or null. */
export function groupAlreadyMerged(active: readonly (readonly number[])[], wanted: readonly number[]): number | null {
  const taken = new Set(active.flat())
  return wanted.find(groupId => taken.has(groupId)) ?? null
}

/**
 * The active merge with exactly the wanted groups (in any order), or null: merging the same groups again (a second
 * tablet that had not reloaded yet) simply finds the merge that is there.
 */
export function identicalMerge<T extends { groupIds: readonly number[] }>(active: readonly T[], wanted: readonly number[]): T | null {
  const set = new Set(wanted)
  return active.find(merge => merge.groupIds.length === set.size && merge.groupIds.every(id => set.has(id))) ?? null
}
