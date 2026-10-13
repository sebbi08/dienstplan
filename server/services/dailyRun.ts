import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { applyDueGroupChanges } from './childGroupChanges'
import { purgeExpiredChildren } from './children'
import { leaveSchoolChildren } from './schoolChildren'

/** Where the daily run reports: the console in the app. Only numbers and facility ids go there, never a name. */
export type DailyRunLog = Pick<Console, 'info' | 'error'>

export interface DailyRunResult {
  /** Planned group changes that were applied. */
  applied: number
  /** School children that were deregistered. */
  deregistered: number
  /** Child records that were deleted after their retention period. */
  deleted: number
}

/**
 * The daily run for all facilities (the app tries it every hour; each part does its work once): the planned group
 * changes whose day has come, then the school children who leave (a change into a group for school children is
 * applied by then), then deleting the records whose retention period is over. A child deregistered in a run is never
 * deleted in it: the leaving passes over a child whose record would be deleted at once.
 *
 * `today` is the one day for all parts, so a run across midnight cannot apply changes for one day and deregister for
 * the next. No part depends on another one succeeding: one that fails is logged, counts as 0 and is tried again by the
 * next run.
 */
export function runDaily(db: Db, today: IsoDate, log: DailyRunLog = console): DailyRunResult {
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
  return { applied, deregistered, deleted }
}
