import { asc, eq } from 'drizzle-orm'
import {
  MAX_TABLET_LOCK_MINUTES, MIN_TABLET_LOCK_MINUTES, noLockWindowsError, sortedWindows, type TimeWindow,
} from '../../shared/domain/tablet'
import type { TabletSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, tabletUnlockedWindows } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** What the settings take: the windows may be left out (then they stay as they are). */
export type TabletSettingsInput = Omit<TabletSettingsDto, 'noLockWindows'> & { noLockWindows?: TimeWindow[] }

/** The facility's windows without the automatic lock, by start. */
export function getNoLockWindows(db: Db, facilityId: number): TimeWindow[] {
  return db.select({ start: tabletUnlockedWindows.start, end: tabletUnlockedWindows.end }).from(tabletUnlockedWindows)
    .where(eq(tabletUnlockedWindows.facilityId, facilityId))
    .orderBy(asc(tabletUnlockedWindows.start), asc(tabletUnlockedWindows.end)).all()
}

/** The facility's tablet settings (404 facility_not_found). */
export function getTabletSettings(db: Db, facilityId: number): TabletSettingsDto {
  const row = db.select({
    lockMinutes: facilities.tabletLockMinutes, showWaitlist: facilities.tabletShowWaitlist,
    showFutureContracts: facilities.tabletShowFutureContracts,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return { ...row, noLockWindows: getNoLockWindows(db, facilityId) }
}

/**
 * Stores the facility's tablet settings: the lock time is a whole number of minutes from 1 to 30, else 400
 * tablet_lock_minutes_invalid (404 facility_not_found). Given windows without the automatic lock replace the stored ones
 * (see noLockWindowsError: 400 tablet_windows_too_many, invalid_time, tablet_window_invalid, tablet_windows_overlap).
 * A new lock time or new windows apply at once, also to a tablet that is unlocked.
 */
export function setTabletSettings(db: Db, facilityId: number, input: TabletSettingsInput): void {
  const { lockMinutes, showWaitlist, showFutureContracts, noLockWindows } = input
  if (!Number.isInteger(lockMinutes) || lockMinutes < MIN_TABLET_LOCK_MINUTES || lockMinutes > MAX_TABLET_LOCK_MINUTES) {
    throw new ServiceError(400, 'tablet_lock_minutes_invalid')
  }
  const refused = noLockWindows ? noLockWindowsError(noLockWindows) : null
  if (refused) throw new ServiceError(400, refused.code)
  getTabletSettings(db, facilityId)
  db.transaction((tx) => {
    tx.update(facilities)
      .set({ tabletLockMinutes: lockMinutes, tabletShowWaitlist: showWaitlist, tabletShowFutureContracts: showFutureContracts })
      .where(eq(facilities.id, facilityId)).run()
    if (!noLockWindows) return
    tx.delete(tabletUnlockedWindows).where(eq(tabletUnlockedWindows.facilityId, facilityId)).run()
    const rows = sortedWindows(noLockWindows).map(window => ({ facilityId, start: window.start, end: window.end }))
    if (rows.length > 0) tx.insert(tabletUnlockedWindows).values(rows).run()
  })
}
