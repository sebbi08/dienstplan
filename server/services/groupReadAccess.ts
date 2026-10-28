import { asc, eq } from 'drizzle-orm'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import type { Db } from '../db/client'
import { groupReadAccess, groups } from '../db/schema'
import { assertGroup, facilityOfGroup } from './groups'

/**
 * The facility a manager sets a group's read access in: the Leitung only in her active facility (a group of another
 * one is then 404 group_not_found); the Träger, whose facility settings list every facility, in the group's own (the
 * permission to edit other facilities, settings.otherFacility, of the acting person).
 */
export function readAccessFacility(
  db: Db, user: { permissions: ReadonlySet<PermissionKey>; facilityId: number }, groupId: number,
): number {
  return can(user.permissions, 'settings.otherFacility') ? facilityOfGroup(db, groupId) : user.facilityId
}

/** Every group of the facility with the groups its staff may also read (empty = none), by group id. */
export function listReadAccess(db: Db, facilityId: number): Record<number, number[]> {
  const result: Record<number, number[]> = {}
  for (const group of db.select({ id: groups.id }).from(groups).where(eq(groups.facilityId, facilityId)).all()) {
    result[group.id] = []
  }
  const grants = db.select({ groupId: groupReadAccess.groupId, readable: groupReadAccess.readableGroupId })
    .from(groupReadAccess).innerJoin(groups, eq(groups.id, groupReadAccess.groupId))
    .where(eq(groups.facilityId, facilityId)).orderBy(asc(groupReadAccess.readableGroupId)).all()
  for (const grant of grants) result[grant.groupId]!.push(grant.readable)
  return result
}

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
