import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { mealVersions, meals } from '../../server/db/schema'
import {
  addMeal, cancelMealVersion, changeMeal, listMeals, mealVersionsOf, removeMeal,
} from '../../server/services/meals'
import { mealsOn } from '../../shared/domain/meals'
import { addFacility, createTestDb, errorCode } from '../helpers/fixtures'

// 10:00 in Berlin on Monday 2026-10-19.
const NOW = new Date('2026-10-19T08:00:00.000Z')
const TODAY = '2026-10-19'
const TOMORROW = '2026-10-20'
const YESTERDAY = '2026-10-18'

describe('meals per facility', () => {
  let db: Db
  /** The ids of facility 1's meals from the migration, by name. */
  let snack: number
  let lunch: number
  beforeEach(() => {
    db = createTestDb()
    const current = listMeals(db, 1, NOW).current
    snack = current.find(meal => meal.name === 'Snack')!.mealId
    lunch = current.find(meal => meal.name === 'Mittagessen')!.mealId
  })

  const versionsOf = (mealId: number) => db.select().from(mealVersions).where(eq(mealVersions.mealId, mealId)).all()
  const add = (name: string, time = 900, validFrom = TODAY, facilityId = 1) => addMeal(db, facilityId, { name, time, validFrom }, NOW)

  it('starts with Snack 9:30 and Mittagessen 12:00 since always', () => {
    expect(listMeals(db, 1, NOW)).toEqual({
      current: [{ mealId: snack, name: 'Snack', time: 570 }, { mealId: lunch, name: 'Mittagessen', time: 720 }],
      planned: [],
    })
    expect(mealVersionsOf(db, 1).map(version => version.validFrom)).toEqual([null, null])
  })

  it('a new facility gets its own Snack 9:30 and Mittagessen 12:00', () => {
    const krippe = addFacility(db, 'Krippe')
    const current = listMeals(db, krippe, NOW).current
    expect(current.map(({ name, time }) => ({ name, time }))).toEqual([{ name: 'Snack', time: 570 }, { name: 'Mittagessen', time: 720 }])
    expect(current.map(meal => meal.mealId)).not.toContain(snack)
    expect(mealVersionsOf(db, krippe).every(version => version.validFrom === null && !version.removed)).toBe(true)
  })

  it('adds a meal from today or as planned from a later day', () => {
    const vesper = add(' Vesper ', 900)
    expect(listMeals(db, 1, NOW).current).toContainEqual({ mealId: vesper, name: 'Vesper', time: 900 })
    const fruehstueck = add('Frühstück', 480, '2026-11-02')
    const list = listMeals(db, 1, NOW)
    expect(list.current.map(meal => meal.mealId)).not.toContain(fruehstueck)
    expect(list.planned).toEqual([
      { versionId: versionsOf(vesper)[0]!.id, mealId: vesper, validFrom: TODAY, name: 'Vesper', time: 900, removed: false, cancelRemovesMeal: true },
      {
        versionId: versionsOf(fruehstueck)[0]!.id, mealId: fruehstueck, validFrom: '2026-11-02', name: 'Frühstück', time: 480, removed: false,
        cancelRemovesMeal: true,
      },
    ])
  })

  it('checks name, time, date and the number of meals', () => {
    expect(errorCode(() => add('   '))).toBe('meal_name_required')
    expect(errorCode(() => add('x'.repeat(41)))).toBe('meal_name_too_long')
    expect(errorCode(() => add('snack'))).toBe('meal_name_taken')
    expect(errorCode(() => add(' MITTAGESSEN '))).toBe('meal_name_taken')
    expect(errorCode(() => add('Vesper', 1440))).toBe('attendance_time_invalid')
    expect(errorCode(() => add('Vesper', -1))).toBe('attendance_time_invalid')
    expect(errorCode(() => add('Vesper', 900.5))).toBe('attendance_time_invalid')
    expect(errorCode(() => add('Vesper', 900, YESTERDAY))).toBe('meal_valid_from_past')
    expect(errorCode(() => add('Vesper', 900, '2026-02-30'))).toBe('invalid_date')
    expect(db.select().from(meals).where(eq(meals.facilityId, 1)).all()).toHaveLength(2)

    add('x'.repeat(40), 0)
    add('Vesper', 1439)
    for (const name of ['Obst', 'Brotzeit', 'Tee', 'Kuchen']) add(name)
    expect(listMeals(db, 1, NOW).current).toHaveLength(8)
    expect(errorCode(() => add('Neuntes'))).toBe('meal_limit')
    // A planned meal counts as well.
    removeMeal(db, 1, snack, TODAY, NOW)
    add('Abendbrot', 1080, '2026-12-01')
    expect(errorCode(() => add('Neuntes'))).toBe('meal_limit')
  })

  it('a removed meal frees its name and its place', () => {
    removeMeal(db, 1, snack, TODAY, NOW)
    const again = add('Snack', 600)
    expect(again).not.toBe(snack)
    expect(listMeals(db, 1, NOW).current.map(meal => meal.name)).toEqual(['Snack', 'Mittagessen'])
  })

  it('names are unique per facility only', () => {
    const krippe = addFacility(db, 'Krippe')
    expect(errorCode(() => add('Vesper', 900, TODAY, krippe))).toBeNull()
    expect(errorCode(() => add('Vesper'))).toBeNull()
  })

  it('changes a meal from a day on; earlier days keep the version before', () => {
    changeMeal(db, 1, lunch, { name: 'Mittag', time: 735, validFrom: TOMORROW }, NOW)
    const list = listMeals(db, 1, NOW)
    expect(list.current).toContainEqual({ mealId: lunch, name: 'Mittagessen', time: 720 })
    expect(list.planned).toMatchObject([{ mealId: lunch, validFrom: TOMORROW, name: 'Mittag', time: 735, removed: false }])
    // Keeping the own name (also in other case) is no clash.
    expect(errorCode(() => changeMeal(db, 1, snack, { name: 'SNACK', time: 600, validFrom: TODAY }, NOW))).toBeNull()
    expect(listMeals(db, 1, NOW).current).toContainEqual({ mealId: snack, name: 'SNACK', time: 600 })
  })

  it('checks a change like a new meal, and only the facility\'s own meals', () => {
    const change = (mealId: number, name: string, time = 720, validFrom = TODAY, facilityId = 1) =>
      errorCode(() => changeMeal(db, facilityId, mealId, { name, time, validFrom }, NOW))
    expect(change(lunch, 'snack')).toBe('meal_name_taken')
    expect(change(lunch, '')).toBe('meal_name_required')
    expect(change(lunch, 'y'.repeat(41))).toBe('meal_name_too_long')
    expect(change(lunch, 'Mittag', 1440)).toBe('attendance_time_invalid')
    expect(change(lunch, 'Mittag', 720, YESTERDAY)).toBe('meal_valid_from_past')
    const krippe = addFacility(db, 'Krippe')
    expect(change(lunch, 'Mittag', 720, TODAY, krippe)).toBe('meal_not_found')
    expect(change(9999, 'Mittag')).toBe('meal_not_found')
    expect(errorCode(() => removeMeal(db, krippe, lunch, TODAY, NOW))).toBe('meal_not_found')
    expect(versionsOf(lunch)).toHaveLength(1)
  })

  it('the same meal and day twice gives one version, the later input wins', () => {
    changeMeal(db, 1, lunch, { name: 'Mitagessen', time: 735, validFrom: TOMORROW }, NOW)
    changeMeal(db, 1, lunch, { name: 'Mittagessen', time: 735, validFrom: TOMORROW }, NOW)
    expect(versionsOf(lunch).filter(version => version.validFrom === TOMORROW)).toHaveLength(1)
    expect(listMeals(db, 1, NOW).planned).toMatchObject([{ mealId: lunch, validFrom: TOMORROW, name: 'Mittagessen', time: 735 }])
    // A removal on the same day replaces the change as well.
    removeMeal(db, 1, lunch, TOMORROW, NOW)
    expect(versionsOf(lunch)).toHaveLength(2)
    expect(listMeals(db, 1, NOW).planned).toMatchObject([{ mealId: lunch, validFrom: TOMORROW, removed: true }])
  })

  it('removes a meal from a day on', () => {
    removeMeal(db, 1, snack, TOMORROW, NOW)
    let list = listMeals(db, 1, NOW)
    expect(list.current.map(meal => meal.name)).toEqual(['Snack', 'Mittagessen'])
    expect(list.planned).toMatchObject([{ mealId: snack, validFrom: TOMORROW, name: 'Snack', time: 570, removed: true }])
    removeMeal(db, 1, lunch, TODAY, NOW)
    list = listMeals(db, 1, NOW)
    expect(list.current.map(meal => meal.name)).toEqual(['Snack'])
    expect(errorCode(() => removeMeal(db, 1, snack, YESTERDAY, NOW))).toBe('meal_valid_from_past')
  })

  it('removing drops the changes planned after it', () => {
    changeMeal(db, 1, lunch, { name: 'Mittag', time: 735, validFrom: '2026-11-02' }, NOW)
    removeMeal(db, 1, lunch, '2026-10-26', NOW)
    expect(listMeals(db, 1, NOW).planned).toMatchObject([{ mealId: lunch, validFrom: '2026-10-26', removed: true }])
    expect(mealVersionsOf(db, 1).filter(version => version.mealId === lunch)).toHaveLength(2)
  })

  it('removing on the day of a planned reactivation drops the reactivation', () => {
    removeMeal(db, 1, snack, '2026-10-26', NOW)
    changeMeal(db, 1, snack, { name: 'Snack', time: 600, validFrom: '2026-11-02' }, NOW)
    expect(mealsOn(mealVersionsOf(db, 1), '2026-11-02').map(meal => meal.name)).toEqual(['Snack', 'Mittagessen'])
    removeMeal(db, 1, snack, '2026-11-02', NOW)
    const versions = mealVersionsOf(db, 1)
    expect(mealsOn(versions, '2026-11-02').map(meal => meal.name)).toEqual(['Mittagessen'])
    expect(mealsOn(versions, '2026-10-25').map(meal => meal.name)).toEqual(['Snack', 'Mittagessen'])
    expect(versionsOf(snack).map(version => [version.validFrom, version.removed])).toEqual([[null, false], ['2026-10-26', true]])
  })

  it('checks the name on every day from the change on', () => {
    changeMeal(db, 1, snack, { name: 'Frühstück', time: 480, validFrom: '2026-11-02' }, NOW)
    expect(errorCode(() => add('Snack', 900, TODAY))).toBe('meal_name_taken')
    expect(errorCode(() => add('Snack', 900, '2026-11-02'))).toBeNull()
    // A rename into a name another meal only has later is refused as well.
    changeMeal(db, 1, lunch, { name: 'Mittag', time: 720, validFrom: '2026-11-09' }, NOW)
    expect(errorCode(() => changeMeal(db, 1, snack, { name: 'Mittag', time: 480, validFrom: '2026-11-02' }, NOW))).toBe('meal_name_taken')
  })

  it('checks the number of meals on every day from the new meal on', () => {
    for (const name of ['Obst', 'Brotzeit', 'Tee', 'Kuchen', 'Vesper', 'Abendbrot']) add(name)
    removeMeal(db, 1, snack, '2026-10-26', NOW)
    expect(errorCode(() => add('Neuntes', 900, TODAY))).toBe('meal_limit')
    expect(errorCode(() => add('Neuntes', 900, '2026-10-26'))).toBeNull()
    // Bringing Snack back from later would make nine again.
    expect(errorCode(() => changeMeal(db, 1, snack, { name: 'Snack', time: 570, validFrom: '2026-11-02' }, NOW))).toBe('meal_limit')
  })

  it('cancelling a planned version restores the one before', () => {
    changeMeal(db, 1, lunch, { name: 'Mittag', time: 735, validFrom: TODAY }, NOW)
    expect(listMeals(db, 1, NOW).current).toContainEqual({ mealId: lunch, name: 'Mittag', time: 735 })
    const today = versionsOf(lunch).find(version => version.validFrom === TODAY)!
    cancelMealVersion(db, 1, today.id, NOW)
    expect(listMeals(db, 1, NOW).current).toContainEqual({ mealId: lunch, name: 'Mittagessen', time: 720 })
    expect(versionsOf(lunch)).toHaveLength(1)

    removeMeal(db, 1, snack, TOMORROW, NOW)
    cancelMealVersion(db, 1, versionsOf(snack).find(version => version.removed)!.id, NOW)
    expect(listMeals(db, 1, NOW)).toMatchObject({ planned: [] })
    expect(listMeals(db, 1, NOW).current).toHaveLength(2)
  })

  it('cancelling the only version of a planned meal deletes the meal', () => {
    const fruehstueck = add('Frühstück', 480, '2026-11-02')
    cancelMealVersion(db, 1, versionsOf(fruehstueck)[0]!.id, NOW)
    expect(db.select().from(meals).where(eq(meals.id, fruehstueck)).get()).toBeUndefined()
    expect(listMeals(db, 1, NOW).planned).toEqual([])
  })

  it('cancelling the last version that is not removed deletes the meal', () => {
    const fruehstueck = add('Frühstück', 480, '2026-11-02')
    removeMeal(db, 1, fruehstueck, '2026-11-09', NOW)
    cancelMealVersion(db, 1, versionsOf(fruehstueck).find(version => !version.removed)!.id, NOW)
    expect(db.select().from(meals).where(eq(meals.id, fruehstueck)).get()).toBeUndefined()
    expect(listMeals(db, 1, NOW).planned).toEqual([])
  })

  it('lists the changes of today with the planned ones, so they can be taken back', () => {
    changeMeal(db, 1, lunch, { name: 'Mittag', time: 735, validFrom: TODAY }, NOW)
    changeMeal(db, 1, lunch, { name: 'Mittag', time: 750, validFrom: '2026-11-02' }, NOW)
    const vesper = add('Vesper', 900)
    removeMeal(db, 1, snack, TODAY, NOW)
    const versionId = (mealId: number, validFrom: string) => versionsOf(mealId).find(version => version.validFrom === validFrom)!.id
    expect(listMeals(db, 1, NOW).planned).toEqual([
      { versionId: versionId(snack, TODAY), mealId: snack, validFrom: TODAY, name: 'Snack', time: 570, removed: true, cancelRemovesMeal: false },
      { versionId: versionId(lunch, TODAY), mealId: lunch, validFrom: TODAY, name: 'Mittag', time: 735, removed: false, cancelRemovesMeal: false },
      { versionId: versionId(vesper, TODAY), mealId: vesper, validFrom: TODAY, name: 'Vesper', time: 900, removed: false, cancelRemovesMeal: true },
      {
        versionId: versionId(lunch, '2026-11-02'), mealId: lunch, validFrom: '2026-11-02', name: 'Mittag', time: 750, removed: false,
        cancelRemovesMeal: false,
      },
    ])
  })

  it('cancelling checks the name again on the day of the version and every later version start', () => {
    const vesper = add('Vesper', 900)
    removeMeal(db, 1, vesper, '2026-10-26', NOW)
    const removal = versionsOf(vesper).find(version => version.removed)!
    const other = add('Vesper', 960, '2026-10-26')
    expect(errorCode(() => cancelMealVersion(db, 1, removal.id, NOW))).toBe('meal_name_taken')
    expect(versionsOf(vesper)).toHaveLength(2)
    // Only from a later day on: Snack is called „Vesper“ from 2026-11-02, after the other Vesper is gone again.
    removeMeal(db, 1, other, '2026-10-26', NOW)
    expect(db.select().from(meals).where(eq(meals.id, other)).get()).toBeUndefined()
    changeMeal(db, 1, snack, { name: 'vesper', time: 570, validFrom: '2026-11-02' }, NOW)
    expect(errorCode(() => cancelMealVersion(db, 1, removal.id, NOW))).toBe('meal_name_taken')
    expect(versionsOf(vesper)).toHaveLength(2)
  })

  it('cancelling checks the number of meals again', () => {
    const obst = add('Obst')
    for (const name of ['Brotzeit', 'Tee', 'Kuchen', 'Vesper', 'Abendbrot']) add(name)
    removeMeal(db, 1, obst, '2026-10-26', NOW)
    add('Neuntes', 900, '2026-10-26')
    const removal = versionsOf(obst).find(version => version.removed)!
    expect(errorCode(() => cancelMealVersion(db, 1, removal.id, NOW))).toBe('meal_limit')
    expect(versionsOf(obst)).toHaveLength(2)
  })

  it('cancels neither versions of the past nor those of another facility', () => {
    const since = versionsOf(snack)[0]!
    expect(errorCode(() => cancelMealVersion(db, 1, since.id, NOW))).toBe('meal_valid_from_past')
    changeMeal(db, 1, snack, { name: 'Snack', time: 600, validFrom: TOMORROW }, NOW)
    const planned = versionsOf(snack).find(version => version.validFrom === TOMORROW)!
    // The next day the version from "tomorrow" is of today, and still cancellable; a day later it is past.
    expect(errorCode(() => cancelMealVersion(db, 1, planned.id, new Date('2026-10-21T08:00:00.000Z')))).toBe('meal_valid_from_past')
    const krippe = addFacility(db, 'Krippe')
    expect(errorCode(() => cancelMealVersion(db, krippe, planned.id, NOW))).toBe('meal_not_found')
    expect(errorCode(() => cancelMealVersion(db, 1, 9999, NOW))).toBe('meal_not_found')
    expect(versionsOf(snack)).toHaveLength(2)
    cancelMealVersion(db, 1, planned.id, new Date('2026-10-20T08:00:00.000Z'))
    expect(versionsOf(snack)).toHaveLength(1)
  })
})
