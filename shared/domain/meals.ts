import type { IsoDate, Minutes } from './types'

// Meals with dated versions: a meal keeps its identity (`mealId`), name and time change from a date on.

/** One version of a meal: valid from `validFrom` (null = since always) until the next version; `removed` = the meal is gone from then on. */
export interface MealVersion { id: number, mealId: number, validFrom: IsoDate | null, name: string, time: Minutes, removed: boolean }

/** A meal as it applies on one day. */
export interface DayMeal { mealId: number, name: string, time: Minutes }

const byTimeThenName = (a: { time: Minutes, name: string }, b: { time: Minutes, name: string }) =>
  a.time - b.time || a.name.localeCompare(b.name, 'de')

/** Whether `a` starts later than `b` (null = since always is the lowest; the higher id wins a tie). */
function startsLater(a: MealVersion, b: MealVersion): boolean {
  if (a.validFrom === b.validFrom) return a.id > b.id
  if (a.validFrom === null) return false
  if (b.validFrom === null) return true
  return a.validFrom > b.validFrom
}

/**
 * The meals on a day: per meal the version with the greatest `validFrom` up to the day; a meal without such a version or
 * whose version is removed is left out. Sorted by time, then name.
 */
export function mealsOn(versions: MealVersion[], date: IsoDate): DayMeal[] {
  const latest = new Map<number, MealVersion>()
  for (const version of versions) {
    if (version.validFrom !== null && version.validFrom > date) continue
    const known = latest.get(version.mealId)
    if (known === undefined || startsLater(version, known)) latest.set(version.mealId, version)
  }
  return [...latest.values()]
    .filter(version => !version.removed)
    .map(version => ({ mealId: version.mealId, name: version.name, time: version.time }))
    .sort(byTimeThenName)
}

/**
 * The meals applying today and the versions that start today or later (by date, then time): those can still be taken
 * back, today's as well.
 */
export function currentAndPlanned(versions: MealVersion[], today: IsoDate): { current: DayMeal[], planned: MealVersion[] } {
  const planned = versions
    .filter(version => version.validFrom !== null && version.validFrom >= today)
    .sort((a, b) => (a.validFrom as IsoDate).localeCompare(b.validFrom as IsoDate) || byTimeThenName(a, b))
  return { current: mealsOn(versions, today), planned }
}
