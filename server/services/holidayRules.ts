import { eq } from 'drizzle-orm'
import { publicHolidayRules, type HolidayRules } from '../../shared/domain/holidays'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'

/**
 * Whether 24 and 31 December are paid free for the facility's staff: under the TVöD SuE (§ 6 Abs. 3) always, otherwise
 * when the facility chose „bezahlt frei“ for them (see HolidayRules.paidEves).
 */
export function paidEvesOf(row: { tvoedSue: boolean; christmasEvePaidFree: boolean }): boolean {
  return row.tvoedSue || row.christmasEvePaidFree
}

/**
 * The holiday rules of the facility for its staff (its state, the Bavaria flag and the paid free 24 and 31 December);
 * 404 facility_not_found when it does not exist. The children's care days and the legal checks use
 * facilityPublicHolidayRules instead.
 */
export function facilityHolidayRules(db: Db, facilityId: number): HolidayRules {
  const row = db.select({
    state: facilities.state, assumptionDay: facilities.assumptionDay, tvoedSue: facilities.tvoedSue,
    christmasEvePaidFree: facilities.christmasEvePaidFree,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return { state: row.state, assumptionDay: row.assumptionDay, paidEves: paidEvesOf(row) }
}

/** Only the public holidays of the facility's state (no paid free 24/31 December): for the children's care days. */
export function facilityPublicHolidayRules(db: Db, facilityId: number): HolidayRules {
  return publicHolidayRules(facilityHolidayRules(db, facilityId))
}
