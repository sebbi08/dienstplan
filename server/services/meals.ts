import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import { currentAndPlanned, mealsOn, type MealVersion } from '../../shared/domain/meals'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate, Minutes } from '../../shared/domain/types'
import type { MealSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { mealVersions, meals } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { uniqueName } from '../lib/uniqueName'

// Meals per facility (spec Essen §2): a meal keeps its id, its name and time change by dated versions, so past days
// keep the meals they had. Every change applies from a day on, today at the earliest.

/** At most this many meals that are not removed per facility. */
const MAX_MEALS = 8
const MAX_NAME = 40

/** What a new meal or a change of one sets from `validFrom` on. */
export interface MealInput { name: string; time: Minutes; validFrom: IsoDate }

/** The meals every new facility starts with, since always. */
export const DEFAULT_MEALS: { name: string; time: Minutes }[] = [{ name: 'Snack', time: 570 }, { name: 'Mittagessen', time: 720 }]

/** A day after every planned change: the meals on it are those whose version that starts last is not removed. */
const END_OF_TIME = '9999-12-31'

/** Every version of the facility's meals (by meal, then id). */
export function mealVersionsOf(db: Db, facilityId: number): MealVersion[] {
  return db.select({
    id: mealVersions.id, mealId: mealVersions.mealId, validFrom: mealVersions.validFrom, name: mealVersions.name,
    time: mealVersions.time, removed: mealVersions.removed,
  }).from(mealVersions).innerJoin(meals, eq(meals.id, mealVersions.mealId)).where(eq(meals.facilityId, facilityId))
    .orderBy(asc(mealVersions.mealId), asc(mealVersions.id)).all()
}

/** The meals of today and the changes planned after today. */
export function listMeals(db: Db, facilityId: number, now: Date = new Date()): MealSettingsDto {
  const { current, planned } = currentAndPlanned(mealVersionsOf(db, facilityId), nowInBerlin(now).date)
  return {
    current,
    planned: planned.map(version => ({
      versionId: version.id, mealId: version.mealId, validFrom: version.validFrom as IsoDate, name: version.name,
      time: version.time, removed: version.removed,
    })),
  }
}

/** Gives a new facility the default meals since always. */
export function seedDefaultMeals(db: Db, facilityId: number): void {
  for (const meal of DEFAULT_MEALS) {
    const { id } = db.insert(meals).values({ facilityId }).returning({ id: meals.id }).get()
    db.insert(mealVersions).values({ mealId: id, validFrom: null, name: meal.name, time: meal.time }).run()
  }
}

/** 400 invalid_date for no date, 400 meal_valid_from_past for a day before today. */
function assertFromToday(validFrom: string, now: Date): void {
  if (!isValidIsoDate(validFrom)) throw new ServiceError(400, 'invalid_date')
  if (validFrom < nowInBerlin(now).date) throw new ServiceError(400, 'meal_valid_from_past')
}

/**
 * Checks a new meal or a change of `exceptMealId`: the time is a minute of the day (attendance_time_invalid), the date
 * today or later, the name 1–40 characters (meal_name_required, meal_name_too_long) and not the name of another meal
 * that is not removed (409 meal_name_taken, case-insensitive), and at most 8 such meals with this one (meal_limit).
 * Another meal counts by its version that starts last, planned ones included. Returns the trimmed name.
 */
function checked(db: Db, facilityId: number, input: MealInput, exceptMealId: number | null, now: Date): string {
  if (!Number.isInteger(input.time) || input.time < 0 || input.time > 1439) throw new ServiceError(400, 'attendance_time_invalid')
  assertFromToday(input.validFrom, now)
  if (input.name.trim().length > MAX_NAME) throw new ServiceError(400, 'meal_name_too_long')
  const others = mealsOn(mealVersionsOf(db, facilityId), END_OF_TIME).filter(meal => meal.mealId !== exceptMealId)
  const name = uniqueName(others.map(meal => ({ id: meal.mealId, name: meal.name })), input.name, exceptMealId,
    { required: 'meal_name_required', taken: 'meal_name_taken' })
  if (others.length >= MAX_MEALS) throw new ServiceError(400, 'meal_limit')
  return name
}

/** The meal must belong to the facility; otherwise 404 meal_not_found. */
function assertMeal(db: Db, facilityId: number, mealId: number): void {
  const row = db.select({ id: meals.id }).from(meals).where(and(eq(meals.id, mealId), eq(meals.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'meal_not_found')
}

/** Stores a version of the meal; one on the same day (also the one since always) is replaced in place. */
function putVersion(tx: Db, mealId: number, version: { validFrom: IsoDate | null; name: string; time: Minutes; removed: boolean }) {
  const sameDay = version.validFrom === null ? isNull(mealVersions.validFrom) : eq(mealVersions.validFrom, version.validFrom)
  const existing = tx.select({ id: mealVersions.id }).from(mealVersions).where(and(eq(mealVersions.mealId, mealId), sameDay)).get()
  const values = { name: version.name, time: version.time, removed: version.removed }
  if (existing) tx.update(mealVersions).set(values).where(eq(mealVersions.id, existing.id)).run()
  else tx.insert(mealVersions).values({ mealId, validFrom: version.validFrom, ...values }).run()
}

/** A new meal from `validFrom` on (today at the earliest); returns its id. Checked as described at `checked`. */
export function addMeal(db: Db, facilityId: number, input: MealInput, now: Date = new Date()): number {
  return db.transaction((tx) => {
    const name = checked(tx, facilityId, input, null, now)
    const { id } = tx.insert(meals).values({ facilityId }).returning({ id: meals.id }).get()
    putVersion(tx, id, { validFrom: input.validFrom, name, time: input.time, removed: false })
    return id
  })
}

/**
 * Name and time of the meal from `validFrom` on (today at the earliest); days before keep the version they had, a
 * change on the same day replaces that one. 404 meal_not_found for a meal of another facility; checked as at `checked`.
 */
export function changeMeal(db: Db, facilityId: number, mealId: number, input: MealInput, now: Date = new Date()): void {
  db.transaction((tx) => {
    assertMeal(tx, facilityId, mealId)
    const name = checked(tx, facilityId, input, mealId, now)
    putVersion(tx, mealId, { validFrom: input.validFrom, name, time: input.time, removed: false })
  })
}

/**
 * From `validFrom` on (today at the earliest) the meal is gone; days before keep it. Changes planned after that day are
 * dropped; a meal that would have no day left at all is deleted. 404 meal_not_found for a meal of another facility.
 */
export function removeMeal(db: Db, facilityId: number, mealId: number, validFrom: IsoDate, now: Date = new Date()): void {
  assertFromToday(validFrom, now)
  db.transaction((tx) => {
    assertMeal(tx, facilityId, mealId)
    tx.delete(mealVersions).where(and(eq(mealVersions.mealId, mealId), gt(mealVersions.validFrom, validFrom))).run()
    const left = mealVersionsOf(tx, facilityId).filter(version => version.mealId === mealId)
    const before = left.filter(version => version.validFrom === null || version.validFrom < validFrom)
    if (before.length === 0) {
      tx.delete(meals).where(eq(meals.id, mealId)).run()
      return
    }
    const [last] = mealsOn(before, END_OF_TIME)
    if (last === undefined) return // gone already
    // The removed version keeps the name and time it ends, for the list of planned changes.
    putVersion(tx, mealId, { validFrom, name: last.name, time: last.time, removed: true })
  })
}

/**
 * Takes back a change of today or later: the version before applies again. A meal without any version left is
 * deleted. 404 meal_not_found for a version of another facility, 400 meal_valid_from_past for one that already began.
 */
export function cancelMealVersion(db: Db, facilityId: number, versionId: number, now: Date = new Date()): void {
  db.transaction((tx) => {
    const version = tx.select({ mealId: mealVersions.mealId, validFrom: mealVersions.validFrom }).from(mealVersions)
      .innerJoin(meals, eq(meals.id, mealVersions.mealId))
      .where(and(eq(mealVersions.id, versionId), eq(meals.facilityId, facilityId))).get()
    if (!version) throw new ServiceError(404, 'meal_not_found')
    if (version.validFrom === null || version.validFrom < nowInBerlin(now).date) throw new ServiceError(400, 'meal_valid_from_past')
    tx.delete(mealVersions).where(eq(mealVersions.id, versionId)).run()
    const rest = tx.select({ id: mealVersions.id }).from(mealVersions).where(eq(mealVersions.mealId, version.mealId)).get()
    if (!rest) tx.delete(meals).where(eq(meals.id, version.mealId)).run()
  })
}
