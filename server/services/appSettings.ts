import { eq } from 'drizzle-orm'
import type { IsoDate } from '../../shared/domain/types'
import type { AppSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { appSettings, facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'

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

function readSetting(db: Db, key: string): string | undefined {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value
}

function writeSetting(db: Db, key: string, value: string): void {
  db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
}

export function getAppSettings(db: Db, facilityId: number): AppSettingsDto {
  return { timeTrackingFrom: getTimeTrackingFrom(db, facilityId), contractVisibleToAdmins: contractVisibleToAdmins(db) }
}

const CONTRACT_VISIBLE_TO_ADMINS = 'contract_visible_to_admins'

/** Whether the Leitung may see the employees' contract data (the Träger decides; default no). */
export function contractVisibleToAdmins(db: Db): boolean {
  return readSetting(db, CONTRACT_VISIBLE_TO_ADMINS) === 'true'
}

export function setContractVisibleToAdmins(db: Db, visible: boolean): void {
  writeSetting(db, CONTRACT_VISIBLE_TO_ADMINS, String(visible))
}

const CHILD_RETENTION_YEARS = 'child_retention_years'
const CHILDREN_PURGED_ON = 'children_purged_on'
const DEFAULT_CHILD_RETENTION_YEARS = 3

/** Whole years a child's record is kept after the leaving day (one setting for all facilities; default 3). */
export function getChildRetentionYears(db: Db): number {
  const stored = Number(readSetting(db, CHILD_RETENTION_YEARS))
  return Number.isInteger(stored) && stored >= 1 && stored <= 10 ? stored : DEFAULT_CHILD_RETENTION_YEARS
}

/** The Träger sets the retention: whole years from 1 to 10, otherwise 400 invalid_retention. */
export function setChildRetentionYears(db: Db, years: number): void {
  if (!Number.isInteger(years) || years < 1 || years > 10) throw new ServiceError(400, 'invalid_retention')
  writeSetting(db, CHILD_RETENTION_YEARS, String(years))
}

/** The day the automatic deletion of children ran last (null: never). */
export function getChildrenPurgedOn(db: Db): IsoDate | null {
  return readSetting(db, CHILDREN_PURGED_ON) ?? null
}

export function setChildrenPurgedOn(db: Db, day: IsoDate): void {
  writeSetting(db, CHILDREN_PURGED_ON, day)
}
