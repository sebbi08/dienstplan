import { and, asc, eq, isNull } from 'drizzle-orm'
import { distinctGroups, groupAlreadyMerged, identicalMerge } from '../../shared/domain/groupMerges'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { GroupMergeInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { groupMerges } from '../db/schema'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { listGroups } from './groups'

// „Gruppen zusammenlegen“ (Anwesenheit): at the edge times the children of several groups are in one room. A merge is
// stored per facility and day so every tablet of the facility shows it; it ends with „Zusammenlegung beenden“ or with
// the day (a row of an earlier date is simply ignored). Whoever may stamp in the day list may merge and end (the route
// checks children.attendance; any groups of the facility, not only the person's own). The row logs who did it, by name.

/** A merge as the day list reads it: its groups still there, in the groups' order. */
export interface ActiveGroupMerge { id: number; groupIds: number[]; createdByName: string; createdAt: string }

/** The group ids of a stored row; anything unreadable counts as none. */
function storedIds(json: string): number[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : []
  }
  catch {
    return []
  }
}

/**
 * The facility's merges of the date that were not ended, oldest first. A deleted group drops out; a merge left with
 * fewer than two groups counts as ended.
 */
export function activeGroupMerges(db: Db, facilityId: number, date: IsoDate): ActiveGroupMerge[] {
  const rank = new Map(listGroups(db, facilityId).map((group, index) => [group.id, index]))
  return db.select().from(groupMerges)
    .where(and(eq(groupMerges.facilityId, facilityId), eq(groupMerges.date, date), isNull(groupMerges.endedAt)))
    .orderBy(asc(groupMerges.id)).all()
    .map(row => ({
      id: row.id,
      groupIds: distinctGroups(storedIds(row.groupIds)).filter(id => rank.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)!),
      createdByName: row.createdByName,
      createdAt: row.createdAt,
    }))
    .filter(merge => merge.groupIds.length >= 2)
}

/**
 * Merges two or more groups of the facility for today: another day 400 group_merge_not_today, fewer than two different
 * groups 400 group_merge_too_few, a group of another facility or an unknown one 404 group_not_found, a group already in
 * an active merge of today 409 group_merge_taken; exactly the groups of an active merge again: that merge (no error).
 * Returns the merge's id.
 */
export function createGroupMerge(db: Db, viewer: ChildViewer, input: GroupMergeInput, now: Date = new Date()): number {
  if (input.date !== nowInBerlin(now).date) throw new ServiceError(400, 'group_merge_not_today')
  const wanted = distinctGroups(input.groupIds)
  if (wanted.length < 2) throw new ServiceError(400, 'group_merge_too_few')
  const known = new Set(listGroups(db, viewer.facilityId).map(group => group.id))
  if (wanted.some(id => !known.has(id))) throw new ServiceError(404, 'group_not_found')
  return db.transaction((tx) => {
    const merges = activeGroupMerges(tx, viewer.facilityId, input.date)
    // The same groups again (another tablet merged them meanwhile): that merge, no error.
    const same = identicalMerge(merges, wanted)
    if (same) return same.id
    if (groupAlreadyMerged(merges.map(merge => merge.groupIds), wanted) !== null) throw new ServiceError(409, 'group_merge_taken')
    return tx.insert(groupMerges).values({
      facilityId: viewer.facilityId, date: input.date, groupIds: JSON.stringify(wanted),
      createdAt: now.toISOString(), createdByName: viewer.name,
    }).returning({ id: groupMerges.id }).get().id
  })
}

/**
 * Ends a merge of today („Zusammenlegung beenden“), logging who did; one already ended, of an earlier day, of another
 * facility or unknown: 404 group_merge_not_found.
 */
export function endGroupMerge(db: Db, viewer: ChildViewer, id: number, now: Date = new Date()): void {
  const ended = db.update(groupMerges).set({ endedAt: now.toISOString(), endedByName: viewer.name })
    .where(and(
      eq(groupMerges.id, id), eq(groupMerges.facilityId, viewer.facilityId), eq(groupMerges.date, nowInBerlin(now).date),
      isNull(groupMerges.endedAt),
    )).run()
  if (ended.changes === 0) throw new ServiceError(404, 'group_merge_not_found')
}
