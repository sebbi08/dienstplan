import { describe, expect, it } from 'vitest'
import type { AttendanceChildDto } from '../../shared/types/api'
import { de } from '../../app/locales/de'
import { mealSummaryTable } from '../../app/utils/mealSummary'

const child = (groupId: number | null) => ({ groupId }) as AttendanceChildDto

describe('meal table of a day', () => {
  it('counts per group the children eating and the listed ones not eating, and the total', () => {
    const table = mealSummaryTable({
      meals: [{ mealId: 1, name: 'Snack', time: 570 }, { mealId: 2, name: 'Mittagessen', time: 720 }],
      summary: [
        { groupId: 7, name: 'Igel', here: 3, meals: { 1: 3, 2: 2 } },
        { groupId: null, name: '', here: 1, meals: { 1: 0, 2: 1 } },
      ],
      children: [child(7), child(7), child(7), child(7), child(null), child(null)],
    })
    expect(table.rows).toEqual([
      { groupId: 7, name: 'Igel', here: 3, meals: [{ mealId: 1, eating: 3, notEating: 1 }, { mealId: 2, eating: 2, notEating: 2 }] },
      { groupId: null, name: '', here: 1, meals: [{ mealId: 1, eating: 0, notEating: 2 }, { mealId: 2, eating: 1, notEating: 1 }] },
    ])
    expect(table.total).toEqual({
      groupId: null, name: '', here: 4, meals: [{ mealId: 1, eating: 3, notEating: 3 }, { mealId: 2, eating: 3, notEating: 3 }],
    })
  })

  it('has no meal cells on a day without meals', () => {
    const table = mealSummaryTable({ meals: [], summary: [{ groupId: 7, name: 'Igel', here: 2, meals: {} }], children: [child(7), child(7)] })
    expect(table.rows).toEqual([{ groupId: 7, name: 'Igel', here: 2, meals: [] }])
    expect(table.total).toEqual({ groupId: null, name: '', here: 2, meals: [] })
  })
})

describe('meal texts', () => {
  it('counts "Kinder" in the plural and "1 Kind" in the singular', () => {
    expect(de.attendance.mealChildren(22)).toBe('22 Kinder')
    expect(de.attendance.mealChildren(1)).toBe('1 Kind')
    expect(de.attendance.mealChildren(0)).toBe('0 Kinder')
  })

  it('heads a meal tile with name and time, and adds "nicht" to a table cell', () => {
    expect(de.attendance.mealTileHead('Frühstück', '8:00')).toBe('Frühstück · 8:00')
    expect(de.attendance.notEating(2)).toBe('2 nicht')
  })
})
