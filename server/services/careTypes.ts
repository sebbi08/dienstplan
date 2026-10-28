import { and, eq, max } from 'drizzle-orm'
import type { CareTypeDto, CareTypeInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { careTypes, children } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { uniqueName } from '../lib/uniqueName'

const DAY_MINUTES = 24 * 60

function toDto(row: typeof careTypes.$inferSelect): CareTypeDto {
  return { id: row.id, name: row.name, start: row.start, end: row.end, sortOrder: row.sortOrder, daysPerWeek: row.daysPerWeek }
}

/** Care days per week: a whole number 1–7 (400 care_type_invalid_days); left out = `fallback`. */
function checkedDays(days: number | undefined, fallback: number): number {
  if (days === undefined) return fallback
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new ServiceError(400, 'care_type_invalid_days')
  return days
}

/** The facility's care types by start, then end, then name. */
export function listCareTypes(db: Db, facilityId: number): CareTypeDto[] {
  return db.select().from(careTypes).where(eq(careTypes.facilityId, facilityId)).all().map(toDto)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.name.localeCompare(b.name, 'de') || a.id - b.id)
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
  const existing = db.select({ id: careTypes.id, name: careTypes.name }).from(careTypes)
    .where(eq(careTypes.facilityId, facilityId)).all()
  return uniqueName(existing, name, exceptId, { required: 'care_type_name_required', taken: 'care_type_name_taken' })
}

/**
 * Both times within the day and on the 5-minute grid, the end after the start; otherwise 400 care_type_invalid_time
 * (invalid_time belongs to "im Dienst erkrankt" and has another message).
 */
function checkedTimes(input: CareTypeInput): void {
  const { start, end } = input
  const onGrid = (value: number) => Number.isInteger(value) && value >= 0 && value <= DAY_MINUTES && value % 5 === 0
  if (!onGrid(start) || !onGrid(end) || end <= start) throw new ServiceError(400, 'care_type_invalid_time')
}

/** A new care type (the input's sortOrder is ignored; the stored value is no longer used for ordering). */
export function createCareType(db: Db, facilityId: number, input: CareTypeInput): CareTypeDto {
  const name = checkedName(db, facilityId, input.name)
  checkedTimes(input)
  const daysPerWeek = checkedDays(input.daysPerWeek, 5)
  const sortOrder = (db.select({ value: max(careTypes.sortOrder) }).from(careTypes)
    .where(eq(careTypes.facilityId, facilityId)).get()?.value ?? -1) + 1
  return toDto(db.insert(careTypes).values({ facilityId, name, start: input.start, end: input.end, sortOrder, daysPerWeek })
    .returning().get())
}

/** Updates a care type; daysPerWeek left out keeps the stored days. */
export function updateCareType(db: Db, facilityId: number, id: number, input: CareTypeInput): CareTypeDto {
  assertCareType(db, facilityId, id)
  const name = checkedName(db, facilityId, input.name, id)
  checkedTimes(input)
  const days = input.daysPerWeek === undefined ? {} : { daysPerWeek: checkedDays(input.daysPerWeek, 5) }
  return toDto(db.update(careTypes)
    .set({ name, start: input.start, end: input.end, ...days })
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
