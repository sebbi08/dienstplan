import type { MyPlanDayDto, TimeDayDto } from '#shared/types/api'

/**
 * Phones show one card per day; a day without duty and without anything stamped or noted shrinks to one slim grey line
 * (weekends, free days, Urlaub …), so the month stays short. The slim line still offers adding a time and the absences.
 */
export function isCompactTimeDay(day: TimeDayDto): boolean {
  return !day.plannedDuty && day.records.length === 0 && day.warnings.length === 0 && day.sickLeave === null
    && day.note === '' && day.changes.length === 0
}

/** "Mein Dienstplan" on phones: a day without entries, stamped times, info texts, events or changes is one slim line. */
export function isCompactMyPlanDay(day: MyPlanDayDto, recordCount: number): boolean {
  return day.entries.length === 0 && recordCount === 0 && day.info1 === '' && day.info2 === ''
    && day.autoEvents.length === 0 && day.changes.length === 0
}
