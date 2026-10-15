import { eq } from 'drizzle-orm'
import type { HolidayRules } from '../../shared/domain/holidays'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** The public-holiday rules of the facility (its state and the Bavaria flag); 404 facility_not_found when it does not exist. */
export function facilityHolidayRules(db: Db, facilityId: number): HolidayRules {
  const row = db.select({ state: facilities.state, assumptionDay: facilities.assumptionDay })
    .from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return { state: row.state, assumptionDay: row.assumptionDay }
}
