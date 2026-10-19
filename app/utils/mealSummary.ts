import type { AttendanceDayDto } from '#shared/types/api'

/** One meal of a row of the meal table: the children counted for it and those of the list who are not. */
export interface MealSummaryCell {
  mealId: number
  eating: number
  notEating: number
}

/** A row of the meal table: one group of the day list (`groupId: null` = without group), or the total. */
export interface MealSummaryRow {
  groupId: number | null
  /** The group's name ('' for the children without group and for the total). */
  name: string
  here: number
  meals: MealSummaryCell[]
}

/**
 * The meal table of a day (counts only, no names): per group of the list the children here and per meal of the day
 * the children counted for it and the group's listed children not counted ("nicht"), then the total over all groups.
 */
export function mealSummaryTable(day: Pick<AttendanceDayDto, 'meals' | 'summary' | 'children'>): { rows: MealSummaryRow[]; total: MealSummaryRow } {
  const listed = new Map<number | null, number>()
  for (const child of day.children) listed.set(child.groupId, (listed.get(child.groupId) ?? 0) + 1)
  const rows = day.summary.map((row): MealSummaryRow => ({
    groupId: row.groupId,
    name: row.name,
    here: row.here,
    meals: day.meals.map((meal) => {
      const eating = row.meals[meal.mealId] ?? 0
      return { mealId: meal.mealId, eating, notEating: Math.max(0, (listed.get(row.groupId) ?? 0) - eating) }
    }),
  }))
  const total: MealSummaryRow = {
    groupId: null,
    name: '',
    here: rows.reduce((sum, row) => sum + row.here, 0),
    meals: day.meals.map((meal, index) => ({
      mealId: meal.mealId,
      eating: rows.reduce((sum, row) => sum + row.meals[index]!.eating, 0),
      notEating: rows.reduce((sum, row) => sum + row.meals[index]!.notEating, 0),
    })),
  }
  return { rows, total }
}
