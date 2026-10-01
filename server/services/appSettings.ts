import { eq } from 'drizzle-orm'
import type { IsoDate } from '../../shared/domain/types'
import type { AppSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { appSettings } from '../db/schema'

const TIME_TRACKING_FROM = 'time_tracking_from'

export function getTimeTrackingFrom(db: Db): IsoDate | null {
  return db.select().from(appSettings).where(eq(appSettings.key, TIME_TRACKING_FROM)).get()?.value ?? null
}

export function setTimeTrackingFrom(db: Db, value: IsoDate | null): void {
  if (value === null) {
    db.delete(appSettings).where(eq(appSettings.key, TIME_TRACKING_FROM)).run()
    return
  }
  db.insert(appSettings).values({ key: TIME_TRACKING_FROM, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
}

/** The start date when time tracking already runs today, otherwise null (plan only). */
export function activeTrackingFrom(db: Db, today: IsoDate): IsoDate | null {
  const from = getTimeTrackingFrom(db)
  return from !== null && from <= today ? from : null
}

export function getAppSettings(db: Db): AppSettingsDto {
  return { timeTrackingFrom: getTimeTrackingFrom(db) }
}
