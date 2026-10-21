import { eq } from 'drizzle-orm'
import { MAX_MARK_TOLERANCE, MIN_MARK_TOLERANCE } from '../../shared/domain/timeMarks'
import type { TimeMarkSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** How the facility's time tracking marks late arrivals and early leaving (404 facility_not_found). */
export function getTimeMarkSettings(db: Db, facilityId: number): TimeMarkSettingsDto {
  const row = db.select({ toleranceMinutes: facilities.markToleranceMinutes, markEarlyLeave: facilities.markEarlyLeave })
    .from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row
}

/**
 * Stores the facility's marking: the tolerance ("Kulanz") is a whole number of minutes from 0 to 60, else 400
 * mark_tolerance_invalid (404 facility_not_found). It applies at once to every day shown, also to earlier months.
 */
export function setTimeMarkSettings(db: Db, facilityId: number, input: TimeMarkSettingsDto): void {
  const { toleranceMinutes, markEarlyLeave } = input
  if (!Number.isInteger(toleranceMinutes) || toleranceMinutes < MIN_MARK_TOLERANCE || toleranceMinutes > MAX_MARK_TOLERANCE) {
    throw new ServiceError(400, 'mark_tolerance_invalid')
  }
  getTimeMarkSettings(db, facilityId)
  db.update(facilities).set({ markToleranceMinutes: toleranceMinutes, markEarlyLeave }).where(eq(facilities.id, facilityId)).run()
}
