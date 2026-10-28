import { eq } from 'drizzle-orm'
import type { LeaveCountingDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** How the facility counts leave days (404 facility_not_found). */
export function getLeaveCounting(db: Db, facilityId: number): LeaveCountingDto {
  const row = db.select({ christmasEveHalfLeave: facilities.christmasEveHalfLeave })
    .from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row
}

/**
 * Stores whether 24 and 31 December count as half a leave day for the staff the facility is home to (404
 * facility_not_found). It is a pure calculation: every year's leave account, request and closure booking follows it.
 */
export function setLeaveCounting(db: Db, facilityId: number, input: LeaveCountingDto): LeaveCountingDto {
  getLeaveCounting(db, facilityId)
  db.update(facilities).set({ christmasEveHalfLeave: input.christmasEveHalfLeave }).where(eq(facilities.id, facilityId)).run()
  return getLeaveCounting(db, facilityId)
}
