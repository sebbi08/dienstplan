import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { groupReadAccess } from '../db/schema'
import { assertGroup } from './groups'

/** The groups whose group book the staff of this group of the facility may also read; 404 group_not_found otherwise. */
export function getReadAccess(db: Db, facilityId: number, groupId: number): number[] {
  assertGroup(db, facilityId, groupId)
  return readableGroupIds(db, groupId)
}

/** The groups the staff of this group may also read, without checking its facility (for the child viewer). */
export function readableGroupIds(db: Db, groupId: number): number[] {
  return db.select({ id: groupReadAccess.readableGroupId }).from(groupReadAccess)
    .where(eq(groupReadAccess.groupId, groupId)).orderBy(asc(groupReadAccess.readableGroupId)).all().map(row => row.id)
}

/**
 * Replaces the groups the staff of this group may also read (one direction; an empty list takes every grant away).
 * Every group must belong to the facility, on either side (404 group_not_found, nothing changes); the group itself
 * and repeated ids are dropped. Applies with the next request, also at an unlocked tablet.
 */
export function setReadAccess(db: Db, facilityId: number, groupId: number, readable: number[]): void {
  assertGroup(db, facilityId, groupId)
  const ids = [...new Set(readable)].filter(id => id !== groupId)
  for (const id of ids) assertGroup(db, facilityId, id)
  db.transaction((tx) => {
    tx.delete(groupReadAccess).where(eq(groupReadAccess.groupId, groupId)).run()
    if (ids.length > 0) tx.insert(groupReadAccess).values(ids.map(id => ({ groupId, readableGroupId: id }))).run()
  })
}
