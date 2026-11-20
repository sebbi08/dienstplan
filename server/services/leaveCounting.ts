import { eq } from 'drizzle-orm'
import type { EveLeave, LeaveCountingDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { bookFreedClosureDays } from './closures'
import { facilityHolidayRules } from './holidayRules'

/**
 * How the facility treats 24 and 31 December (404 facility_not_found): whether it works under the TVöD SuE (then both
 * days are paid free, TVöD § 6 Abs. 3) and its own choice for when it does not: a whole or half leave day, or paid free.
 * The choice is kept while the TVöD switch is on.
 */
export function getLeaveCounting(db: Db, facilityId: number): LeaveCountingDto {
  const row = db.select({
    tvoedSue: facilities.tvoedSue, half: facilities.christmasEveHalfLeave, paid: facilities.christmasEvePaidFree,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  const eveLeave: EveLeave = row.paid ? 'paid' : row.half ? 'half' : 'whole'
  return { tvoedSue: row.tvoedSue, eveLeave }
}

/** Whether a leave day on 24 or 31 December counts as half a day (never while both days are paid free). */
export function halfLeaveOnEves(counting: LeaveCountingDto): boolean {
  return !counting.tvoedSue && counting.eveLeave === 'half'
}

/**
 * Stores the TVöD switch and the choice for 24 and 31 December for the staff the facility is home to (404
 * facility_not_found). It is a pure calculation: every year's target hours, leave account, request and closure booking
 * follows it. When the two days stop being paid free, the facility's closures are booked on them as creating the
 * closure would have (bookFreedClosureDays, as after a change of the state), in the same transaction.
 */
export function setLeaveCounting(
  db: Db, facilityId: number, input: LeaveCountingDto, actor: SessionUser, now: Date = new Date(),
): LeaveCountingDto {
  const before = facilityHolidayRules(db, facilityId)
  db.transaction((tx) => {
    tx.update(facilities).set({
      tvoedSue: input.tvoedSue, christmasEveHalfLeave: input.eveLeave === 'half', christmasEvePaidFree: input.eveLeave === 'paid',
    }).where(eq(facilities.id, facilityId)).run()
    if (before.paidEves && !facilityHolidayRules(tx, facilityId).paidEves) bookFreedClosureDays(tx, actor, facilityId, before, now)
  })
  return getLeaveCounting(db, facilityId)
}
