import { eq } from 'drizzle-orm'
import {
  checkRetentionSettings, RETENTION_DEFAULTS, RetentionSettingsError, type RetentionSettings,
} from '../../shared/domain/retention'
import type { Db } from '../db/client'
import { retentionSettings } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { facilityExists } from './facilities'

/**
 * The facility's retention periods (shared/domain/retention.ts); the first read stores the defaults for it. 404
 * facility_not_found for a facility that does not exist.
 */
export function getRetentionSettings(db: Db, facilityId: number): RetentionSettings {
  const row = db.select().from(retentionSettings).where(eq(retentionSettings.facilityId, facilityId)).get()
  if (row) {
    const { timeYears, assessmentYears, paidOvertimeYears, pensionYears, cashYears, employeeDelete } = row
    return { timeYears, assessmentYears, paidOvertimeYears, pensionYears, cashYears, employeeDelete }
  }
  if (!facilityExists(db, facilityId)) throw new ServiceError(404, 'facility_not_found')
  db.insert(retentionSettings).values({ facilityId, ...RETENTION_DEFAULTS }).onConflictDoNothing().run()
  return { ...RETENTION_DEFAULTS }
}

/**
 * The Träger stores the facility's retention periods: whole years 1–40 (cash 1–30) and the delete mode, otherwise 400
 * retention_settings_invalid and nothing changes (404 facility_not_found). They say from when data may be deleted (by
 * hand); data deleted under the old periods stays deleted. Answers the settings as stored.
 */
export function setRetentionSettings(db: Db, facilityId: number, input: unknown): RetentionSettings {
  let settings: RetentionSettings
  try {
    settings = checkRetentionSettings(input)
  }
  catch (error) {
    if (error instanceof RetentionSettingsError) throw new ServiceError(400, error.code)
    throw error
  }
  getRetentionSettings(db, facilityId)
  db.update(retentionSettings).set(settings).where(eq(retentionSettings.facilityId, facilityId)).run()
  return settings
}
