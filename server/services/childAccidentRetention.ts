import { and, eq, inArray } from 'drizzle-orm'
import { childPurgeDate } from '../../shared/domain/children'
import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { forms } from '../db/schema'

/**
 * Accident reports about a child go with the child's record, so the record stays until the newest one is 5 years old
 * (childPurgeDate, DGUV Vorschrift 1 § 24 Abs. 6). The accident day is the report's „Datum“, else the day it was made.
 */

/** The newest accident day of each of these children that has an accident report. */
export function lastChildAccidents(db: Db, childIds: readonly number[]): Map<number, IsoDate> {
  const map = new Map<number, IsoDate>()
  if (childIds.length === 0) return map
  const rows = db.select({ childId: forms.childId, formDate: forms.formDate, createdAt: forms.createdAt }).from(forms)
    .where(and(eq(forms.kind, 'accident'), inArray(forms.childId, [...childIds]))).all()
  for (const row of rows) {
    const day = row.formDate ?? row.createdAt.slice(0, 10)
    const before = map.get(row.childId!)
    if (before === undefined || day > before) map.set(row.childId!, day)
  }
  return map
}

/** The purge day of one child's record with its accident reports (childPurgeDate). */
export function childRecordPurgeDate(db: Db, childId: number, leftOn: IsoDate, years: number): IsoDate {
  return childPurgeDate(leftOn, years, lastChildAccidents(db, [childId]).get(childId) ?? null)
}
