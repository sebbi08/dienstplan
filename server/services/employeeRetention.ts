import { and, asc, isNotNull, lt } from 'drizzle-orm'
import { retentionDueDates, type RetentionSettings } from '../../shared/domain/retention'
import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { employees } from '../db/schema'
import {
  deleteCategories, deleteEmployeeRow, foreignKeyViolations, RETENTION_CATEGORIES, type RetentionCategory,
} from './employeeDeletion'
import { getRetentionSettings } from './retentionSettings'

/** Rows deleted (or cleared) per category, and the employee rows deleted. */
export type EmployeeRetentionCounts = Record<RetentionCategory, number> & { employees: number }

/** All categories' rows and the employee rows together. */
export function retentionTotal(counts: EmployeeRetentionCounts): number {
  return RETENTION_CATEGORIES.reduce((sum, category) => sum + counts[category], counts.employees)
}

/**
 * The automatic deletion after leaving (spec Löschfristen §2), for every facility with its own periods as stored now:
 * for each employee who left (`leftOn` before `today`) every category whose due day (retentionDueDates) has come, and
 * the employee row once every category is due. An employee whose leaving was taken back (no `leftOn`, or one not
 * passed yet) is skipped; what was deleted stays deleted. Each employee in a transaction of their own: one that fails,
 * or would leave a reference behind, is rolled back, logged by id (never a name) and tried again by the next run.
 * Run again on the same day it deletes nothing.
 */
export function runEmployeeRetention(db: Db, today: IsoDate, log: Pick<Console, 'error'> = console): EmployeeRetentionCounts {
  const counts: EmployeeRetentionCounts = { immediate: 0, time: 0, assessment: 0, paidOvertime: 0, employees: 0 }
  const left = db.select({ id: employees.id, facilityId: employees.facilityId, leftOn: employees.leftOn }).from(employees)
    .where(and(isNotNull(employees.leftOn), lt(employees.leftOn, today))).orderBy(asc(employees.id)).all()
  if (left.length === 0) return counts
  const settings = new Map<number, RetentionSettings>()
  // Only violations a deletion would add count: an old one elsewhere (say from a restored backup) blocks nothing. A
  // committed employee added none, so the set stays right for the next one.
  const before = new Set(foreignKeyViolations(db))
  for (const employee of left) {
    try {
      if (!settings.has(employee.facilityId)) settings.set(employee.facilityId, getRetentionSettings(db, employee.facilityId))
      const due = retentionDueDates(employee.leftOn!, settings.get(employee.facilityId)!)
      const dueCategories = RETENTION_CATEGORIES.filter(category => due[category] <= today)
      const last = dueCategories.length === RETENTION_CATEGORIES.length
      const done = db.transaction((tx) => {
        const changed: EmployeeRetentionCounts = {
          ...deleteCategories(tx, employee.id, dueCategories), employees: last ? deleteEmployeeRow(tx, employee.id) : 0,
        }
        if (retentionTotal(changed) > 0 && foreignKeyViolations(tx).some(violation => !before.has(violation))) {
          throw new Error(`The deletion would leave a reference to employee ${employee.id} behind`)
        }
        return changed
      })
      for (const key of [...RETENTION_CATEGORIES, 'employees'] as const) counts[key] += done[key]
    }
    catch (error) {
      log.error(`Deleting the data of left employee ${employee.id} after the retention periods failed`, error)
    }
  }
  return counts
}
