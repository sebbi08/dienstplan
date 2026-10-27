import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { getEmployeeRetentionRanOn, setEmployeeRetentionRanOn } from './appSettings'
import { applyDueGroupChanges } from './childGroupChanges'
import { purgeExpiredChildren } from './children'
import { retentionTotal, runEmployeeRetention } from './employeeRetention'
import { leaveSchoolChildren } from './schoolChildren'
import { deleteExpiredUnlocks } from './tabletUnlock'

/** Where the daily run reports: the console in the app. Only numbers and facility ids go there, never a name. */
export type DailyRunLog = Pick<Console, 'info' | 'error'>

export interface DailyRunResult {
  /** Planned group changes that were applied. */
  applied: number
  /** School children that were deregistered. */
  deregistered: number
  /** Child records that were deleted after their retention period. */
  deleted: number
  /** Rows of left employees deleted after the retention periods (all categories and the employee rows together). */
  employeeDataDeleted: number
  /** Tablet unlocks of child records that ran out. */
  unlocksDeleted: number
}

/**
 * The deletion of left employees' data (runEmployeeRetention), at most once per calendar day: it reads every release
 * snapshot for each person whose time data is due, which the hourly tries need not repeat.
 */
function employeeRetentionOncePerDay(db: Db, today: IsoDate, log: DailyRunLog): number {
  if (getEmployeeRetentionRanOn(db) === today) return 0
  const counts = runEmployeeRetention(db, today, log)
  setEmployeeRetentionRanOn(db, today)
  const total = retentionTotal(counts)
  if (total > 0) {
    log.info(`Deleted data of left employees after the retention periods: ${counts.immediate} immediately, `
      + `${counts.time} time data, ${counts.assessment} assessments, ${counts.paidOvertime} paid overtime, `
      + `${counts.employees} employee record(s).`)
  }
  return total
}

/**
 * The daily run for all facilities (the app tries it every hour; each part does its work once): the planned group
 * changes whose day has come, then the school children who leave (a change into a group for school children is
 * applied by then), then deleting the records whose retention period is over, then the data of left employees whose
 * retention periods are over (spec Löschfristen §2). A child deregistered in a run is never deleted in it: the leaving
 * passes over a child whose record would be deleted at once. Last, the tablet unlocks that ran out (as of `now`) are
 * deleted.
 *
 * `today` is the one day for all parts, so a run across midnight cannot apply changes for one day and deregister for
 * the next. No part depends on another one succeeding: one that fails is logged, counts as 0 and is tried again by the
 * next run.
 */
export function runDaily(db: Db, today: IsoDate, log: DailyRunLog = console, now: Date = new Date()): DailyRunResult {
  const part = (failure: string, run: () => number): number => {
    try {
      return run()
    }
    catch (error) {
      log.error(failure, error)
      return 0
    }
  }
  const applied = part('Applying planned group changes failed', () => applyDueGroupChanges(db, today))
  if (applied > 0) log.info(`Applied ${applied} group change(s).`)
  // A facility that fails is logged by the service and skipped.
  const deregistered = part('Deregistering school children failed', () => leaveSchoolChildren(db, today, log))
  if (deregistered > 0) log.info(`Deregistered ${deregistered} school child(ren).`)
  const deleted = part('Deleting expired child records failed', () => purgeExpiredChildren(db, today))
  if (deleted > 0) log.info(`Deleted ${deleted} child record(s) after the retention period.`)
  // An employee that fails is logged by the service (by id) and tried again the next day.
  const employeeDataDeleted = part('Deleting the data of left employees failed', () => employeeRetentionOncePerDay(db, today, log))
  const unlocksDeleted = part('Deleting expired tablet unlocks failed', () => deleteExpiredUnlocks(db, now))
  if (unlocksDeleted > 0) log.info(`Deleted ${unlocksDeleted} expired tablet unlock(s).`)
  return { applied, deregistered, deleted, employeeDataDeleted, unlocksDeleted }
}
