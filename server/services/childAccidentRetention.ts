import { and, eq, inArray } from 'drizzle-orm'
import { CHILD_ACCIDENT_RETENTION_YEARS, childPurgeDate, purgeDate } from '../../shared/domain/children'
import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { forms } from '../db/schema'

/**
 * Accident reports about a child go with the child's record, so the record stays until the newest one is 5 years old
 * (childPurgeDate, DGUV Vorschrift 1 § 24 Abs. 6). The accident day is the report's „Datum“, else the day it was made.
 */

/** The accident days of each of these children that has accident reports, oldest first. */
export function childAccidentDays(db: Db, childIds: readonly number[]): Map<number, IsoDate[]> {
  const map = new Map<number, IsoDate[]>()
  if (childIds.length === 0) return map
  const rows = db.select({ childId: forms.childId, formDate: forms.formDate, createdAt: forms.createdAt }).from(forms)
    .where(and(eq(forms.kind, 'accident'), inArray(forms.childId, [...childIds]))).all()
  for (const row of rows) map.set(row.childId!, [...(map.get(row.childId!) ?? []), row.formDate ?? row.createdAt.slice(0, 10)])
  for (const days of map.values()) days.sort()
  return map
}

/** The newest accident day of each of these children that has an accident report. */
export function lastChildAccidents(db: Db, childIds: readonly number[]): Map<number, IsoDate> {
  return new Map([...childAccidentDays(db, childIds)].map(([childId, days]) => [childId, days.at(-1)!]))
}

/** The purge day of one child's record with its accident reports (childPurgeDate). */
export function childRecordPurgeDate(db: Db, childId: number, leftOn: IsoDate, years: number): IsoDate {
  return childPurgeDate(leftOn, years, lastChildAccidents(db, [childId]).get(childId) ?? null)
}

/**
 * The accident reports still within their 5 years on `today` (accident day + 5 years after today): how many, and until
 * when the newest must be kept; null without such a report.
 */
export function accidentHoldOf(days: readonly IsoDate[], today: IsoDate): { reports: number; until: IsoDate } | null {
  const kept = days.filter(day => purgeDate(day, CHILD_ACCIDENT_RETENTION_YEARS) > today)
  return kept.length === 0 ? null : { reports: kept.length, until: purgeDate(kept.at(-1)!, CHILD_ACCIDENT_RETENTION_YEARS) }
}
