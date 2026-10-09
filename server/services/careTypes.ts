import { and, asc, eq, max } from 'drizzle-orm'
import type { CareTypeDto, CareTypeInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { careTypes, children } from '../db/schema'
import { ServiceError } from '../lib/errors'

const DAY_MINUTES = 24 * 60

function toDto(row: typeof careTypes.$inferSelect): CareTypeDto {
  return { id: row.id, name: row.name, start: row.start, end: row.end, sortOrder: row.sortOrder }
}

/** The facility's care types in their order. */
export function listCareTypes(db: Db, facilityId: number): CareTypeDto[] {
  return db.select().from(careTypes).where(eq(careTypes.facilityId, facilityId))
    .orderBy(asc(careTypes.sortOrder), asc(careTypes.id)).all().map(toDto)
}

/** The care type must belong to the facility (null = none passes); otherwise 404 care_type_not_found. */
export function assertCareType(db: Db, facilityId: number, id: number | null): void {
  if (id === null) return
  const row = db.select({ id: careTypes.id }).from(careTypes)
    .where(and(eq(careTypes.id, id), eq(careTypes.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'care_type_not_found')
}

/** Trimmed, non-empty name no other care type of the facility uses (compared case-insensitively, umlauts included). */
function checkedName(db: Db, facilityId: number, name: string, exceptId: number | null = null): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'care_type_name_required')
  // In JS, not SQLite's lower(), which only folds ASCII letters (Ä ≠ ä).
  const folded = (value: string) => value.trim().toLocaleLowerCase('de')
  const clash = db.select({ id: careTypes.id, name: careTypes.name }).from(careTypes)
    .where(eq(careTypes.facilityId, facilityId)).all()
    .some(row => row.id !== exceptId && folded(row.name) === folded(trimmed))
  if (clash) throw new ServiceError(409, 'care_type_name_taken')
  return trimmed
}

/** Both times within the day and on the 5-minute grid, the end after the start; otherwise 400 invalid_time. */
function checkedTimes(input: CareTypeInput): void {
  const { start, end } = input
  const onGrid = (value: number) => Number.isInteger(value) && value >= 0 && value <= DAY_MINUTES && value % 5 === 0
  if (!onGrid(start) || !onGrid(end) || end <= start) throw new ServiceError(400, 'invalid_time')
}

/** A new care type at the end of the facility's order (the input's sortOrder is ignored). */
export function createCareType(db: Db, facilityId: number, input: CareTypeInput): CareTypeDto {
  const name = checkedName(db, facilityId, input.name)
  checkedTimes(input)
  const sortOrder = (db.select({ value: max(careTypes.sortOrder) }).from(careTypes)
    .where(eq(careTypes.facilityId, facilityId)).get()?.value ?? -1) + 1
  return toDto(db.insert(careTypes).values({ facilityId, name, start: input.start, end: input.end, sortOrder })
    .returning().get())
}

export function updateCareType(db: Db, facilityId: number, id: number, input: CareTypeInput): CareTypeDto {
  assertCareType(db, facilityId, id)
  const name = checkedName(db, facilityId, input.name, id)
  checkedTimes(input)
  return toDto(db.update(careTypes)
    .set({ name, start: input.start, end: input.end, sortOrder: input.sortOrder })
    .where(eq(careTypes.id, id)).returning().get())
}

/** Deletes a care type no child has (409 care_type_in_use otherwise, also for children who left). */
export function deleteCareType(db: Db, facilityId: number, id: number): void {
  assertCareType(db, facilityId, id)
  if (db.select({ id: children.id }).from(children).where(eq(children.careTypeId, id)).get()) {
    throw new ServiceError(409, 'care_type_in_use')
  }
  db.delete(careTypes).where(eq(careTypes.id, id)).run()
}
