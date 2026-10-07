import type { IsoDate } from './types'

/** One employee being away on leave on one day (planned leave or an open request). */
export interface LeaveDay {
  employeeId: number
  date: IsoDate
}

/** Number of different employees on leave per day. */
export function leaveLoad(days: LeaveDay[]): Map<IsoDate, number> {
  const people = new Map<IsoDate, Set<number>>()
  for (const day of days) people.set(day.date, (people.get(day.date) ?? new Set()).add(day.employeeId))
  return new Map([...people].map(([date, ids]) => [date, ids.size]))
}

/** The given days on which more people than the limit are on leave (none without a limit). */
export function daysOverLimit(load: Map<IsoDate, number>, dates: IsoDate[], limit: number | null): IsoDate[] {
  if (limit === null) return []
  return dates.filter(date => (load.get(date) ?? 0) > limit)
}
