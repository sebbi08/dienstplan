import { asc, eq } from 'drizzle-orm'
import type { EveRule } from '../../shared/domain/eveRules'
import { publicHolidayRules, type HolidayRules } from '../../shared/domain/holidays'
import type { Db } from '../db/client'
import { facilities, facilityEveRules } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** The facility's rules for 24 and 31 December per year (shared/domain/eveRules.ts), oldest first. */
export function facilityEveRulesOf(db: Db, facilityId: number): EveRule[] {
  return db.select({ fromYear: facilityEveRules.fromYear, mode: facilityEveRules.mode }).from(facilityEveRules)
    .where(eq(facilityEveRules.facilityId, facilityId)).orderBy(asc(facilityEveRules.fromYear)).all()
}

/** The rules for 24 and 31 December of every facility, oldest first (one query, for the employee records). */
export function allFacilityEveRules(db: Db): Map<number, EveRule[]> {
  const byFacility = new Map<number, EveRule[]>()
  const rows = db.select().from(facilityEveRules).orderBy(asc(facilityEveRules.fromYear)).all()
  for (const row of rows) {
    const list = byFacility.get(row.facilityId) ?? []
    list.push({ fromYear: row.fromYear, mode: row.mode })
    byFacility.set(row.facilityId, list)
  }
  return byFacility
}

/**
 * The holiday rules of the facility for its staff (its state, the Bavaria flag and its rules for 24 and 31 December
 * per year); 404 facility_not_found when it does not exist. The children's care days, the coverage warnings and the
 * legal checks only see the public holidays (facilityPublicHolidayRules / publicHolidayRules).
 */
export function facilityHolidayRules(db: Db, facilityId: number): HolidayRules {
  const row = db.select({ state: facilities.state, assumptionDay: facilities.assumptionDay })
    .from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return { state: row.state, assumptionDay: row.assumptionDay, eveRules: facilityEveRulesOf(db, facilityId) }
}

/** Only the public holidays of the facility's state (no paid free 24/31 December): for the children's care days. */
export function facilityPublicHolidayRules(db: Db, facilityId: number): HolidayRules {
  return publicHolidayRules(facilityHolidayRules(db, facilityId))
}
