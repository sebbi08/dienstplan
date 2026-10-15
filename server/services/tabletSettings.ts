import { eq } from 'drizzle-orm'
import { MAX_TABLET_LOCK_MINUTES, MIN_TABLET_LOCK_MINUTES } from '../../shared/domain/tablet'
import type { TabletSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** The facility's tablet settings (404 facility_not_found). */
export function getTabletSettings(db: Db, facilityId: number): TabletSettingsDto {
  const row = db.select({
    lockMinutes: facilities.tabletLockMinutes, showWaitlist: facilities.tabletShowWaitlist,
    showFutureContracts: facilities.tabletShowFutureContracts,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row
}

/**
 * Stores the facility's tablet settings: the lock time is a whole number of minutes from 1 to 30, else 400
 * tablet_lock_minutes_invalid (404 facility_not_found). A new lock time applies at once, also to a tablet that is unlocked.
 */
export function setTabletSettings(db: Db, facilityId: number, input: TabletSettingsDto): void {
  const { lockMinutes, showWaitlist, showFutureContracts } = input
  if (!Number.isInteger(lockMinutes) || lockMinutes < MIN_TABLET_LOCK_MINUTES || lockMinutes > MAX_TABLET_LOCK_MINUTES) {
    throw new ServiceError(400, 'tablet_lock_minutes_invalid')
  }
  getTabletSettings(db, facilityId)
  db.update(facilities)
    .set({ tabletLockMinutes: lockMinutes, tabletShowWaitlist: showWaitlist, tabletShowFutureContracts: showFutureContracts })
    .where(eq(facilities.id, facilityId)).run()
}
