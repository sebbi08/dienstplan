import { and, asc, between, eq, inArray } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import type { IsoDate } from '../../shared/domain/types'
import { ackKeyDate } from '../../shared/domain/warningList'
import type { SessionUser, WarningAckDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, warningAcks } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** The name kept with an acknowledgement: the linked employee's, else the username (stays when the account goes). */
function actorName(db: Db, user: SessionUser): string {
  if (user.employeeId === null) return user.username
  return db.select({ name: employees.name }).from(employees).where(eq(employees.id, user.employeeId)).get()?.name ?? user.username
}

/**
 * „Zur Kenntnis genommen“: marks the warnings (key and current values, see shared/domain/warningList.ts) of the facility;
 * one already marked gets the new values, the new time and who marked it.
 */
export function acknowledgeWarnings(
  db: Db, facilityId: number, user: SessionUser, items: { key: string; signature: string }[], now: Date = new Date(),
): void {
  const rows = items.map((item) => {
    const date = ackKeyDate(item.key)
    if (date === null || !isValidIsoDate(date)) throw new ServiceError(400, 'invalid_warning_key')
    return { ...item, date }
  })
  const acknowledgedAt = now.toISOString()
  const acknowledgedByName = actorName(db, user)
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(warningAcks)
        .values({ facilityId, key: row.key, date: row.date, signature: row.signature, acknowledgedAt, acknowledgedBy: user.id, acknowledgedByName })
        .onConflictDoUpdate({
          target: [warningAcks.facilityId, warningAcks.key],
          set: { signature: row.signature, acknowledgedAt, acknowledgedBy: user.id, acknowledgedByName },
        })
        .run()
    }
  })
}

/** „Rückgängig“: removes the facility's acknowledgements of these keys; 404 when none of them is marked here. */
export function revokeWarningAcks(db: Db, facilityId: number, keys: string[]): void {
  const removed = db.delete(warningAcks)
    .where(and(eq(warningAcks.facilityId, facilityId), inArray(warningAcks.key, keys)))
    .run()
  if (removed.changes === 0) throw new ServiceError(404, 'warning_ack_not_found')
}

/** The facility's acknowledgements of warnings on the days from `from` to `to`. */
export function loadWarningAcks(db: Db, facilityId: number, from: IsoDate, to: IsoDate): WarningAckDto[] {
  return db.select({
    key: warningAcks.key, signature: warningAcks.signature, byName: warningAcks.acknowledgedByName, at: warningAcks.acknowledgedAt,
  })
    .from(warningAcks)
    .where(and(eq(warningAcks.facilityId, facilityId), between(warningAcks.date, from, to)))
    .orderBy(asc(warningAcks.date), asc(warningAcks.key))
    .all()
}
