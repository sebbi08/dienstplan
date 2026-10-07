import { and, eq } from 'drizzle-orm'
import { parseIsoDate } from '../../shared/domain/dates'
import type { IsoDate } from '../../shared/domain/types'
import type { ChangeField } from '../../shared/types/api'
import type { Db } from '../db/client'
import { changeLog, monthPlans } from '../db/schema'

export function isMonthReleased(db: Db, facilityId: number, date: IsoDate): boolean {
  const { year, month } = parseIsoDate(date)
  const plan = db.select().from(monthPlans)
    .where(and(eq(monthPlans.facilityId, facilityId), eq(monthPlans.year, year), eq(monthPlans.month, month))).get()
  return Boolean(plan?.releasedAt)
}

/** Records a change of a released month of the facility (the plan the cell or day note belongs to). */
export function logChange(db: Db, change: {
  facilityId: number; date: IsoDate; employeeId: number | null; field: ChangeField
  before: string; after: string; actorId: number; now: string
}): void {
  if (change.before === change.after || !isMonthReleased(db, change.facilityId, change.date)) return
  db.insert(changeLog).values({
    facilityId: change.facilityId, date: change.date, employeeId: change.employeeId, field: change.field,
    before: change.before, after: change.after, changedAt: change.now, changedBy: change.actorId,
  }).run()
}
