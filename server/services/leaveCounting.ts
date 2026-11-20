import { eq } from 'drizzle-orm'
import { parseIsoDate } from '../../shared/domain/dates'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { EveLeave, LeaveCountingDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { bookFreedClosureDays } from './closures'
import { facilityHolidayRules, paidEvesFromOf } from './holidayRules'

/**
 * How the facility treats 24 and 31 December (404 facility_not_found): whether it works under the TVöD SuE (then both
 * days are paid free, TVöD § 6 Abs. 3) and its own choice for when it does not: a whole or half leave day, or paid free.
 * The choice is kept while the TVöD switch is on. `paidEvesFromYear`: the first year the days are paid free (null while
 * they are not); earlier years keep the whole or half leave day.
 */
export function getLeaveCounting(db: Db, facilityId: number): LeaveCountingDto {
  const row = db.select({
    tvoedSue: facilities.tvoedSue, christmasEveHalfLeave: facilities.christmasEveHalfLeave,
    christmasEvePaidFree: facilities.christmasEvePaidFree, paidEvesFromYear: facilities.paidEvesFromYear,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  const eveLeave: EveLeave = row.christmasEvePaidFree ? 'paid' : row.christmasEveHalfLeave ? 'half' : 'whole'
  return { tvoedSue: row.tvoedSue, eveLeave, paidEvesFromYear: paidEvesFromOf(row) }
}

/**
 * Whether a leave day on 24 or 31 December counts as half a day: the stored half day, also with TVöD or „bezahlt frei“
 * (for the years before the days are paid free; from then on they are no leave days at all).
 */
export function halfLeaveOnEves(db: Db, facilityId: number): boolean {
  const row = db.select({ half: facilities.christmasEveHalfLeave }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row.half
}

/**
 * Stores the TVöD switch and the choice for 24 and 31 December for the staff the facility is home to (404
 * facility_not_found). It is a pure calculation: target hours, leave account, requests and closure bookings follow it.
 * The days become paid free from the current year (Berlin) when they were not before; while they stay paid free the
 * stored first year is kept, so earlier years never change. „bezahlt frei“ keeps the stored whole or half day for the
 * years before; whole or half replaces it. When the days stop being paid free, the facility's closures are booked on
 * them as creating the closure would have (bookFreedClosureDays, as after a change of the state), in the same
 * transaction.
 */
export function setLeaveCounting(
  db: Db, facilityId: number, input: Pick<LeaveCountingDto, 'tvoedSue' | 'eveLeave'>, actor: SessionUser, now: Date = new Date(),
): LeaveCountingDto {
  const before = facilityHolidayRules(db, facilityId)
  const paidAfter = input.tvoedSue || input.eveLeave === 'paid'
  const year = parseIsoDate(nowInBerlin(now).date).year
  db.transaction((tx) => {
    tx.update(facilities).set({
      tvoedSue: input.tvoedSue,
      christmasEvePaidFree: input.eveLeave === 'paid',
      ...(input.eveLeave === 'paid' ? {} : { christmasEveHalfLeave: input.eveLeave === 'half' }),
      ...(paidAfter && before.paidEvesFrom == null ? { paidEvesFromYear: year } : {}),
    }).where(eq(facilities.id, facilityId)).run()
    if (before.paidEvesFrom != null && !paidAfter) bookFreedClosureDays(tx, actor, facilityId, before, now)
  })
  return getLeaveCounting(db, facilityId)
}
