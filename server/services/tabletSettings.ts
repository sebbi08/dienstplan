import { eq } from 'drizzle-orm'
import {
  MAX_TABLET_LOCK_MINUTES, MIN_TABLET_LOCK_MINUTES, noLockWindowsError, sortedWindows, type TimeWindow,
} from '../../shared/domain/tablet'
import type { TabletSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, tabletUnlockedWindows } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hasOpeningHoursEveryWeekday } from './openingHours'
import { deleteExpiredUnlocks, getNoLockWindows } from './tabletNoLock'

/** What the settings take: the windows may be left out (then they stay as they are). */
export type TabletSettingsInput = Omit<TabletSettingsDto, 'noLockWindows'> & { noLockWindows?: TimeWindow[] }

/** The lock time and the tablet switches, without the windows (404 facility_not_found). */
export function getTabletSwitches(db: Db, facilityId: number): Omit<TabletSettingsDto, 'noLockWindows'> {
  const row = db.select({
    lockMinutes: facilities.tabletLockMinutes, showWaitlist: facilities.tabletShowWaitlist,
    showFutureContracts: facilities.tabletShowFutureContracts,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row
}

/** The facility's tablet settings (404 facility_not_found). */
export function getTabletSettings(db: Db, facilityId: number): TabletSettingsDto {
  return { ...getTabletSwitches(db, facilityId), noLockWindows: getNoLockWindows(db, facilityId) }
}

/**
 * Stores the facility's tablet settings: the lock time is a whole number of minutes from 1 to 30, else 400
 * tablet_lock_minutes_invalid (404 facility_not_found). Given windows without the automatic lock replace the stored ones
 * (see noLockWindowsError: 400 tablet_windows_too_many, tablet_window_time_invalid, tablet_window_invalid,
 * tablet_windows_overlap; tablet_window_too_long while the facility has no opening hours for every weekday).
 * Unlocks that already ran out are deleted first, under the old settings, so a longer lock time or a new window does not
 * revive them; the new settings apply at once to a tablet that is unlocked.
 */
export function setTabletSettings(db: Db, facilityId: number, input: TabletSettingsInput, now: Date = new Date()): void {
  const { lockMinutes, showWaitlist, showFutureContracts, noLockWindows } = input
  if (!Number.isInteger(lockMinutes) || lockMinutes < MIN_TABLET_LOCK_MINUTES || lockMinutes > MAX_TABLET_LOCK_MINUTES) {
    throw new ServiceError(400, 'tablet_lock_minutes_invalid')
  }
  getTabletSwitches(db, facilityId)
  const refused = noLockWindows
    ? noLockWindowsError(noLockWindows, { limitLength: !hasOpeningHoursEveryWeekday(db, facilityId) })
    : null
  if (refused) throw new ServiceError(400, refused.code)
  db.transaction((tx) => {
    deleteExpiredUnlocks(tx, now)
    tx.update(facilities)
      .set({ tabletLockMinutes: lockMinutes, tabletShowWaitlist: showWaitlist, tabletShowFutureContracts: showFutureContracts })
      .where(eq(facilities.id, facilityId)).run()
    if (!noLockWindows) return
    tx.delete(tabletUnlockedWindows).where(eq(tabletUnlockedWindows.facilityId, facilityId)).run()
    const rows = sortedWindows(noLockWindows).map(window => ({ facilityId, start: window.start, end: window.end }))
    if (rows.length > 0) tx.insert(tabletUnlockedWindows).values(rows).run()
  })
}
