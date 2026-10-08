import { and, asc, eq, max } from 'drizzle-orm'
import type { GroupDto, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import { coverageRules, employees, entries, groups, weekTemplateMarks, weekTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'

function toDto(row: { id: number; name: string; sortOrder: number }): GroupDto {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder }
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
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'group_name_required')
  // In JS, not SQLite's lower(), which only folds ASCII letters (Ä ≠ ä).
  const folded = (value: string) => value.trim().toLocaleLowerCase('de')
  const clash = db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.facilityId, facilityId)).all()
    .some(row => row.id !== exceptId && folded(row.name) === folded(trimmed))
  if (clash) throw new ServiceError(409, 'group_name_taken')
  return trimmed
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

/**
 * Deletes a group that is nobody's home group any more (409 group_has_members otherwise, also for staff who left).
 * Its required duties and week templates go with it; duties that counted for it count for the home group again.
 */
export function deleteGroup(db: Db, facilityId: number, id: number): void {
  assertGroup(db, facilityId, id)
  if (db.select({ id: employees.id }).from(employees).where(eq(employees.groupId, id)).get()) {
    throw new ServiceError(409, 'group_has_members')
  }
  db.transaction((tx) => {
    tx.update(entries).set({ groupId: null }).where(eq(entries.groupId, id)).run()
    tx.delete(coverageRules).where(eq(coverageRules.groupId, id)).run()
    tx.delete(weekTemplateMarks).where(and(eq(weekTemplateMarks.facilityId, facilityId), eq(weekTemplateMarks.groupId, id))).run()
    // Template entries and remaining marks of these templates go along (ON DELETE CASCADE).
    tx.delete(weekTemplates).where(eq(weekTemplates.groupId, id)).run()
    tx.delete(groups).where(eq(groups.id, id)).run()
  })
}
