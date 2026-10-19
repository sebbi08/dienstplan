import { and, asc, eq, gte, isNull } from 'drizzle-orm'
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

/** The meals of today and the changes from today on (today's can still be taken back). */
export function listMeals(db: Db, facilityId: number, now: Date = new Date()): MealSettingsDto {
  const versions = mealVersionsOf(db, facilityId)
  const { current, planned } = currentAndPlanned(versions, nowInBerlin(now).date)
  /** Without the version, the meal is not on the version's first day. */
  const cancelRemovesMeal = (version: MealVersion) => !version.removed
    && !mealsOn(versions.filter(other => other.id !== version.id), version.validFrom as IsoDate).some(meal => meal.mealId === version.mealId)
  return {
    current,
    planned: planned.map(version => ({
      versionId: version.id, mealId: version.mealId, validFrom: version.validFrom as IsoDate, name: version.name,
      time: version.time, removed: version.removed, cancelRemovesMeal: cancelRemovesMeal(version),
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

/** Stands for the meal being added while it has no id yet. */
const NEW_MEAL = -1

/**
 * With `versions` in place, on every day from `from` on that the meal is on: its name is no other meal's name of that
 * day (409 meal_name_taken, case-insensitive) and there are at most 8 meals (meal_limit). Only the start days of
 * versions can change that, so those are the days checked.
 */
function assertFits(versions: MealVersion[], mealId: number, from: IsoDate): void {
  const days = new Set([from])
  for (const version of versions) if (version.validFrom !== null && version.validFrom > from) days.add(version.validFrom)
  for (const day of days) {
    const onDay = mealsOn(versions, day)
    const meal = onDay.find(entry => entry.mealId === mealId)
    if (meal === undefined) continue
    uniqueName(onDay.map(entry => ({ id: entry.mealId, name: entry.name })), meal.name, mealId,
      { required: 'meal_name_required', taken: 'meal_name_taken' })
    if (onDay.length > MAX_MEALS) throw new ServiceError(400, 'meal_limit')
  }
}

/**
 * Checks a new meal (`mealId` null) or a change of a meal: the time is a minute of the day (attendance_time_invalid),
 * the date today or later, the name 1–40 characters (meal_name_required, meal_name_too_long), and with the new
 * version in place the meal fits on every day from `validFrom` on (see `assertFits`). Returns the trimmed name.
 */
function checked(db: Db, facilityId: number, input: MealInput, mealId: number | null, now: Date): string {
  if (!Number.isInteger(input.time) || input.time < 0 || input.time > 1439) throw new ServiceError(400, 'attendance_time_invalid')
  assertFromToday(input.validFrom, now)
  const name = input.name.trim()
  if (!name) throw new ServiceError(400, 'meal_name_required')
  if (name.length > MAX_NAME) throw new ServiceError(400, 'meal_name_too_long')
  const own = mealId ?? NEW_MEAL
  const versions = mealVersionsOf(db, facilityId)
  const candidate: MealVersion = { id: Number.MAX_SAFE_INTEGER, mealId: own, validFrom: input.validFrom, name, time: input.time, removed: false }
  assertFits([...versions.filter(version => version.mealId !== own || version.validFrom !== input.validFrom), candidate], own, input.validFrom)
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
 * From `validFrom` on (today at the earliest) the meal is gone; days before keep it. Its versions from that day on
 * (changes planned, a reactivation included) are dropped; a meal that would have no day left at all is deleted.
 * 404 meal_not_found for a meal of another facility.
 */
export function removeMeal(db: Db, facilityId: number, mealId: number, validFrom: IsoDate, now: Date = new Date()): void {
  assertFromToday(validFrom, now)
  db.transaction((tx) => {
    assertMeal(tx, facilityId, mealId)
    tx.delete(mealVersions).where(and(eq(mealVersions.mealId, mealId), gte(mealVersions.validFrom, validFrom))).run()
    const before = mealVersionsOf(tx, facilityId).filter(version => version.mealId === mealId)
    if (!before.some(version => !version.removed)) {
      tx.delete(meals).where(eq(meals.id, mealId)).run()
      return
    }
    const [last] = mealsOn(before, END_OF_TIME)
    if (last === undefined) return // gone already the day before: nothing to end
    // The removed version keeps the name and time it ends, for the list of planned changes.
    tx.insert(mealVersions).values({ mealId, validFrom, name: last.name, time: last.time, removed: true }).run()
  })
}

/**
 * Takes back a change of today or later: the version before applies again. A meal left without a version that is not
 * removed (it would never be on a day) is deleted, with its ticks. Otherwise the meal must still fit on the version's
 * day and every later version start, as at `checked` (409 meal_name_taken, 400 meal_limit; nothing is changed then).
 * 404 meal_not_found for a version of another facility, 400 meal_valid_from_past for one that already began.
 */
export function cancelMealVersion(db: Db, facilityId: number, versionId: number, now: Date = new Date()): void {
  db.transaction((tx) => {
    const version = tx.select({ mealId: mealVersions.mealId, validFrom: mealVersions.validFrom }).from(mealVersions)
      .innerJoin(meals, eq(meals.id, mealVersions.mealId))
      .where(and(eq(mealVersions.id, versionId), eq(meals.facilityId, facilityId))).get()
    if (!version) throw new ServiceError(404, 'meal_not_found')
    if (version.validFrom === null || version.validFrom < nowInBerlin(now).date) throw new ServiceError(400, 'meal_valid_from_past')
    tx.delete(mealVersions).where(eq(mealVersions.id, versionId)).run()
    const versions = mealVersionsOf(tx, facilityId)
    if (!versions.some(other => other.mealId === version.mealId && !other.removed)) {
      tx.delete(meals).where(eq(meals.id, version.mealId)).run()
      return
    }
    assertFits(versions, version.mealId, version.validFrom)
  })
}
