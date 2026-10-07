import { eq } from 'drizzle-orm'
import type { IsoDate } from '../../shared/domain/types'
import type { AppSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { appSettings, facilities } from '../db/schema'

/** The day time tracking starts in the facility (null: not yet). */
export function getTimeTrackingFrom(db: Db, facilityId: number): IsoDate | null {
  return db.select({ value: facilities.timeTrackingFrom }).from(facilities).where(eq(facilities.id, facilityId)).get()?.value ?? null
}

export function setTimeTrackingFrom(db: Db, facilityId: number, value: IsoDate | null): void {
  db.update(facilities).set({ timeTrackingFrom: value }).where(eq(facilities.id, facilityId)).run()
}

/** The start date when time tracking already runs today in the facility, otherwise null (plan only). */
export function activeTrackingFrom(db: Db, facilityId: number, today: IsoDate): IsoDate | null {
  const from = getTimeTrackingFrom(db, facilityId)
  return from !== null && from <= today ? from : null
}

export function getAppSettings(db: Db, facilityId: number): AppSettingsDto {
  return { timeTrackingFrom: getTimeTrackingFrom(db, facilityId), contractVisibleToAdmins: contractVisibleToAdmins(db) }
}

const CONTRACT_VISIBLE_TO_ADMINS = 'contract_visible_to_admins'

/** Whether the Leitung may see the employees' contract data (the Träger decides; default no). */
export function contractVisibleToAdmins(db: Db): boolean {
  return db.select().from(appSettings).where(eq(appSettings.key, CONTRACT_VISIBLE_TO_ADMINS)).get()?.value === 'true'
}

export function setContractVisibleToAdmins(db: Db, visible: boolean): void {
  const value = String(visible)
  db.insert(appSettings).values({ key: CONTRACT_VISIBLE_TO_ADMINS, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
}
