import { and, asc, eq, isNull, max } from 'drizzle-orm'
import { childStatus } from '../../shared/domain/children'
import type { IsoDate } from '../../shared/domain/types'
import type { GroupDto, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  childGroupChanges, children, coverageRules, employees, entries, facilities, groups, weekTemplateMarks, weekTemplates,
} from '../db/schema'
import { switchAutoLeaveOff } from '../lib/autoLeave'
import { ServiceError } from '../lib/errors'
import { uniqueName } from '../lib/uniqueName'

function toDto(row: typeof groups.$inferSelect): GroupDto {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder, capacity: row.capacity, forSchoolChildren: row.forSchoolChildren }
}

/** The facility's groups in their order. */
export function listGroups(db: Db, facilityId: number): GroupDto[] {
  return db.select().from(groups).where(eq(groups.facilityId, facilityId))
    .orderBy(asc(groups.sortOrder), asc(groups.id)).all().map(toDto)
}

/** The facility's group names by id, for texts that name the group of a single duty ("→ Mäuse"). */
export function groupNames(db: Db, facilityId: number): Record<number, string> {
  return Object.fromEntries(db.select({ id: groups.id, name: groups.name }).from(groups)
    .where(eq(groups.facilityId, facilityId)).all().map(row => [row.id, row.name]))
}

/**
 * Group names for the texts of a plan state: those stored with a release (as the groups were called then, also when
 * deleted or renamed since), over the facility's current names (the draft's, and for snapshots from before groups).
 */
export function snapshotGroupNames(db: Db, facilityId: number): (data: SnapshotData) => Record<number, string> {
  const current = groupNames(db, facilityId)
  return data => ({ ...current, ...Object.fromEntries((data.groups ?? []).map(group => [group.id, group.name])) })
}

/** The group must belong to the facility (null = no group passes); otherwise 404 group_not_found, never confirmed. */
export function assertGroup(db: Db, facilityId: number, groupId: number | null): void {
  if (groupId === null) return
  const row = db.select({ id: groups.id }).from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'group_not_found')
}

/** The facility a group belongs to, for the Träger's routes that name only the group; 404 group_not_found otherwise. */
export function facilityOfGroup(db: Db, groupId: number): number {
  const row = db.select({ facilityId: groups.facilityId }).from(groups).where(eq(groups.id, groupId)).get()
  if (!row) throw new ServiceError(404, 'group_not_found')
  return row.facilityId
}

/** Trimmed, non-empty name no other group of the facility uses (compared case-insensitively, umlauts included). */
function checkedName(db: Db, facilityId: number, name: string, exceptId: number | null = null): string {
  const existing = db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.facilityId, facilityId)).all()
  return uniqueName(existing, name, exceptId, { required: 'group_name_required', taken: 'group_name_taken' })
}

/** A new group at the end of the facility's order. */
export function createGroup(db: Db, facilityId: number, name: string): GroupDto {
  const checked = checkedName(db, facilityId, name)
  const sortOrder = (db.select({ value: max(groups.sortOrder) }).from(groups)
    .where(eq(groups.facilityId, facilityId)).get()?.value ?? -1) + 1
  return toDto(db.insert(groups).values({ facilityId, name: checked, sortOrder }).returning().get())
}

export function renameGroup(db: Db, facilityId: number, id: number, name: string): void {
  assertGroup(db, facilityId, id)
  const checked = checkedName(db, facilityId, name, id)
  db.update(groups).set({ name: checked }).where(eq(groups.id, id)).run()
}

/** Sets the number of places of a group (a whole number from 1 to 200; null = not set). */
export function setGroupCapacity(db: Db, facilityId: number, id: number, capacity: number | null): void {
  assertGroup(db, facilityId, id)
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 200)) {
    throw new ServiceError(400, 'invalid_capacity')
  }
  db.update(groups).set({ capacity }).where(eq(groups.id, id)).run()
}

/**
 * The Träger flags a group as being for school children (after-school care) or takes the flag away; 404
 * group_not_found for an unknown group. A child in such a group on its school start stays instead of leaving the day
 * before, and a change into it needs a further care contract.
 *
 * Taking the flag away from a group that had it makes its school children leave, so it switches the facility's
 * automatic leaving off in the same transaction: the Träger sees whom it takes before switching it on again. Returns
 * the switch as it is afterwards.
 */
export function setGroupForSchoolChildren(db: Db, groupId: number, value: boolean): { autoLeave: boolean } {
  const facilityId = facilityOfGroup(db, groupId)
  return db.transaction((tx) => {
    const widens = !value && isForSchoolChildren(tx, groupId)
    tx.update(groups).set({ forSchoolChildren: value }).where(eq(groups.id, groupId)).run()
    if (widens) switchAutoLeaveOff(tx, facilityId)
    return { autoLeave: autoLeaveOf(tx, facilityId) }
  })
}

/** Whether the facility deregisters its school children automatically. */
function autoLeaveOf(db: Db, facilityId: number): boolean {
  return db.select({ value: facilities.autoLeaveSchoolChildren }).from(facilities)
    .where(eq(facilities.id, facilityId)).get()?.value ?? false
}

/** Whether the group is for school children (null = no group: never). */
export function isForSchoolChildren(db: Db, groupId: number | null): boolean {
  if (groupId === null) return false
  return db.select({ value: groups.forSchoolChildren }).from(groups).where(eq(groups.id, groupId)).get()?.value ?? false
}

/**
 * Deletes a group that is nobody's home group any more (409 group_has_members otherwise, also for staff who left) and
 * that has no active or planned children (409 group_has_children) and no planned group change leading into it
 * (409 group_has_pending_changes). Its required duties and week templates go with it; duties that counted for it count
 * for the home group again; the entries of the children's group histories lose the group.
 *
 * With a group for school children gone, the histories no longer say that a child was in one, so a child that stayed
 * because of it would be deregistered. Deleting such a group therefore switches the facility's automatic leaving off
 * in the same transaction, like taking its flag away. Returns the switch as it is afterwards.
 */
export function deleteGroup(db: Db, facilityId: number, id: number, today: IsoDate): { autoLeave: boolean } {
  assertGroup(db, facilityId, id)
  if (db.select({ id: employees.id }).from(employees).where(eq(employees.groupId, id)).get()) {
    throw new ServiceError(409, 'group_has_members')
  }
  // Active and planned children (also those leaving today) keep their group; archived ones lose it (ON DELETE SET NULL).
  if (db.select().from(children).where(eq(children.groupId, id)).all().some(child => childStatus(child, today) !== 'archived')) {
    throw new ServiceError(409, 'group_has_children')
  }
  // A planned change must not lose its target (applied history entries may: ON DELETE SET NULL).
  if (db.select({ id: childGroupChanges.id }).from(childGroupChanges)
    .where(and(eq(childGroupChanges.groupId, id), isNull(childGroupChanges.appliedAt))).get()) {
    throw new ServiceError(409, 'group_has_pending_changes')
  }
  return db.transaction((tx) => {
    const wasForSchoolChildren = isForSchoolChildren(tx, id)
    tx.update(entries).set({ groupId: null }).where(eq(entries.groupId, id)).run()
    tx.delete(coverageRules).where(eq(coverageRules.groupId, id)).run()
    tx.delete(weekTemplateMarks).where(and(eq(weekTemplateMarks.facilityId, facilityId), eq(weekTemplateMarks.groupId, id))).run()
    // Template entries and remaining marks of these templates go along (ON DELETE CASCADE).
    tx.delete(weekTemplates).where(eq(weekTemplates.groupId, id)).run()
    tx.delete(groups).where(eq(groups.id, id)).run()
    if (wasForSchoolChildren) switchAutoLeaveOff(tx, facilityId)
    return { autoLeave: autoLeaveOf(tx, facilityId) }
  })
}
