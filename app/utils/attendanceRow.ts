// The compact row of the "Anwesenheit" day list. The texts are imported relative so a test can load this file.
import type { DayMeal } from '#shared/domain/meals'
import { formatTime } from '#shared/domain/time'
import type { AttendanceChildDto } from '#shared/types/api'
import { de } from '../locales/de'

/**
 * The colour of a row: here (green), picked up (grey), away sick, on vacation or excused (blue), unexcused (amber),
 * not here yet (white); an overdue pickup (red) wins over all.
 */
export type AttendanceRowTone = 'overdue' | 'present' | 'gone' | 'absent' | 'unexcused' | 'not_yet'

export function attendanceRowTone(child: Pick<AttendanceChildDto, 'status'>, overdue: boolean): AttendanceRowTone {
  if (overdue) return 'overdue'
  switch (child.status) {
    case 'present': return 'present'
    case 'gone': return 'gone'
    case 'not_yet': return 'not_yet'
    case 'unexcused': return 'unexcused'
    default: return 'absent'
  }
}

/** The row's background and the coloured bar on its left, by tone. */
export const ATTENDANCE_ROW_CLASS: Record<AttendanceRowTone, string> = {
  overdue: 'bg-red-50 border-red-600 ring-2 ring-inset ring-red-500',
  present: 'bg-green-50 border-green-600',
  gone: 'bg-gray-100 border-gray-400',
  absent: 'bg-sky-50 border-sky-500',
  unexcused: 'bg-amber-50 border-amber-500',
  not_yet: 'bg-white border-transparent',
}

/** The status text's colour in the compact row, by tone. */
export const ATTENDANCE_STATUS_CLASS: Record<AttendanceRowTone, string> = {
  overdue: 'text-red-800',
  present: 'text-green-800',
  gone: 'text-gray-700',
  absent: 'text-sky-800',
  unexcused: 'text-amber-800',
  not_yet: 'text-gray-600',
}

/** The status of the compact row: "da seit 7:45", "abgeholt um 15:10", "krank", "noch nicht da" … */
export function compactStatusText(child: Pick<AttendanceChildDto, 'status' | 'stays'>): string {
  const last = child.stays[child.stays.length - 1]
  switch (child.status) {
    case 'present': return de.attendance.presentSince(last ? formatTime(last.arrived) : '')
    case 'gone': return de.attendance.row.goneAt(last?.left != null ? formatTime(last.left) : '')
    case 'not_yet': return de.attendance.notYet
    default: return de.attendance.absence[child.status]
  }
}

/**
 * The action the collapsed row offers on its right, as the full row does: "Geht" while the child is here, else "Kommt";
 * nothing on a later day (stamping is not possible there yet).
 */
export function attendanceQuickAction(child: Pick<AttendanceChildDto, 'status'>, futureDay: boolean): 'arrive' | 'leave' | null {
  if (futureDay) return null
  return child.status === 'present' ? 'leave' : 'arrive'
}

/** The names of the day's meals the child is counted for, in the order of the day. */
export function countedMealNames(child: Pick<AttendanceChildDto, 'meals'>, meals: DayMeal[]): string[] {
  return meals.filter(meal => child.meals[meal.mealId]?.counted).map(meal => meal.name)
}

const CLOSED_GROUPS_KEY = 'dienstplan.attendanceClosedGroups'

/** The groups of the day list closed on this device (keys as the list uses them); none when storage is unavailable. */
export function readClosedAttendanceGroups(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CLOSED_GROUPS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []
  }
  catch {
    return []
  }
}

export function writeClosedAttendanceGroups(keys: string[]): void {
  try {
    if (keys.length) localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(keys))
    else localStorage.removeItem(CLOSED_GROUPS_KEY)
  }
  catch {
    // Not remembered; opening and closing still works on this page.
  }
}
