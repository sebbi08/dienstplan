import { and, eq, gt } from 'drizzle-orm'
import { effectiveEveYear, eveModeIn, type EveMode, type EveRule } from '../../shared/domain/eveRules'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { EveLeave, LeaveCountingDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, facilityEveRules } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { bookFreedClosureDays } from './closures'
import { facilityEveRulesOf, facilityHolidayRules } from './holidayRules'

/**
 * How the facility treats 24 and 31 December (404 facility_not_found): whether it works under the TVöD SuE (then both
 * days are paid free, TVöD § 6 Abs. 3), its own choice for when it does not (a whole or half leave day, or paid free;
 * kept while the TVöD switch is on), the year a change saved now applies from, and the rules per year.
 */
export function getLeaveCounting(db: Db, facilityId: number, now: Date = new Date()): LeaveCountingDto {
  const row = db.select({
    tvoedSue: facilities.tvoedSue, half: facilities.christmasEveHalfLeave, paid: facilities.christmasEvePaidFree,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  const eveLeave: EveLeave = row.paid ? 'paid' : row.half ? 'half' : 'whole'
  return {
    tvoedSue: row.tvoedSue, eveLeave, effectiveYear: effectiveEveYear(nowInBerlin(now).date),
    rules: facilityEveRulesOf(db, facilityId),
  }
}

/** The facility's rules per year for weighing 24 and 31 December (half a leave day in a year whose rule is 'half'). */
export function halfLeaveOnEves(db: Db, facilityId: number): readonly EveRule[] {
  return facilityHolidayRules(db, facilityId).eveRules ?? []
}

/**
 * Stores the TVöD switch and the choice for 24 and 31 December (404 facility_not_found) and writes the rule they give
 * (TVöD or „bezahlt frei“: 'paid', else 'whole' or 'half') from the effective year on: this year until 23 December,
 * from 24 December on the next year. The entry of that year is replaced (or dropped when the year before already counts
 * so: no entry for a year in which nothing changes) and later ones dropped; the years before never change. Target hours, leave accounts, requests and closure bookings follow the rules of each year. When the days stop
 * being paid free from the effective year, the facility's closures are booked on them as creating the closure would have
 * (bookFreedClosureDays, only from that year on), in the same transaction.
 */
export function setLeaveCounting(
  db: Db, facilityId: number, input: Pick<LeaveCountingDto, 'tvoedSue' | 'eveLeave'>, actor: SessionUser, now: Date = new Date(),
): LeaveCountingDto {
  const before = facilityHolidayRules(db, facilityId)
  const fromYear = effectiveEveYear(nowInBerlin(now).date)
  const mode: EveMode = input.tvoedSue ? 'paid' : input.eveLeave
  db.transaction((tx) => {
    tx.update(facilities).set({
      tvoedSue: input.tvoedSue, christmasEveHalfLeave: input.eveLeave === 'half', christmasEvePaidFree: input.eveLeave === 'paid',
    }).where(eq(facilities.id, facilityId)).run()
    tx.delete(facilityEveRules)
      .where(and(eq(facilityEveRules.facilityId, facilityId), gt(facilityEveRules.fromYear, fromYear))).run()
    if (eveModeIn(facilityEveRulesOf(tx, facilityId), fromYear - 1) === mode) {
      // The years before already count so: no entry of its own (nothing changes in that year, „gilt ab“ stays put).
      tx.delete(facilityEveRules).where(and(eq(facilityEveRules.facilityId, facilityId), eq(facilityEveRules.fromYear, fromYear))).run()
    }
    else {
      tx.insert(facilityEveRules).values({ facilityId, fromYear, mode })
        .onConflictDoUpdate({ target: [facilityEveRules.facilityId, facilityEveRules.fromYear], set: { mode } }).run()
    }
    bookFreedClosureDays(tx, actor, facilityId, before, now, `${fromYear}-01-01`)
  })
  return getLeaveCounting(db, facilityId, now)
}
