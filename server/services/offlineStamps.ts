import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import {
  clockSkewMinutes, OFFLINE_HINT_REASONS, OFFLINE_MAX_OPEN_WRONG_PINS, offlineStampTimeCheck, type OfflineStampReason,
  type OfflineStampStatus,
} from '../../shared/domain/offlineStamps'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { isEmployedOn } from '../../shared/domain/targets'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type {
  OfflineStampHintDto, OfflineStampInputDto, OfflineStampResultDto, ReminderDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, offlineStamps, timeRecords } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { verifyPassword } from '../lib/password'
import { activeTrackingFrom } from './appSettings'
import { loadEmployee } from './queries'
import { helperIdsOn } from './terminal'

export type OfflineStampInput = OfflineStampInputDto

/** The end of the day for an open record when looking for overlaps. */
const DAY_END = 24 * 60

/**
 * Takes over the stamps of the tablet's offline queue, in the order sent (docs/BETRIEB.md „Stempeln ohne Netz am
 * Tablet“). Per stamp: a client id already known answers `duplicate` and changes nothing. Then the person must be one
 * the tablet may stamp for on the stamp's day (own staff, helpers planned here; else `employee_not_found`), the PIN must
 * be right (checked like the online stamp but WITHOUT counting wrong tries toward the PIN lock, so an old queue cannot
 * lock anybody out; while 5 wrong-PIN offline stamps of the person are unchecked, further ones are not checked at all:
 * `pin_blocked`), the time at most 5 minutes ahead of the server and at most 7 days old, the person employed and time
 * tracking on that day. Kommt opens a record when nothing of the day is open or ends later; Geht closes the day's open
 * record begun before it. Otherwise the stamp goes to the review list (`review`). Taken-over stamps mark the record
 * „offline erfasst“ and, when the tablet's clock (`clientNow`) is more than 5 minutes off the server's, with the
 * difference. Every stamp is stored by its client id (never the PIN); those refused or put on review with a known
 * person are the hints of the time page for Leitung/Träger.
 */
export function syncOfflineStamps(
  db: Db, facilityId: number, input: { clientNow: string; stamps: OfflineStampInput[] }, now: Date = new Date(),
): { results: OfflineStampResultDto[] } {
  const skew = clockSkewMinutes(new Date(input.clientNow), now)
  return { results: input.stamps.map(item => db.transaction(tx => takeOver(tx, facilityId, item, skew, now))) }
}

function takeOver(db: Db, facilityId: number, item: OfflineStampInput, skew: number | null, now: Date): OfflineStampResultDto {
  const known = db.select({ id: offlineStamps.id }).from(offlineStamps).where(eq(offlineStamps.clientId, item.clientId)).get()
  if (known) return { clientId: item.clientId, status: 'duplicate', reason: null }
  const at = new Date(item.stampedAt)
  const { date, minutes } = nowInBerlin(at)
  const finish = (
    status: Exclude<OfflineStampStatus, 'duplicate'>, reason: OfflineStampReason | null, employeeId: number | null,
    recordId: number | null = null,
  ): OfflineStampResultDto => {
    db.insert(offlineStamps).values({
      clientId: item.clientId, facilityId, employeeId, action: item.action, stampedAt: item.stampedAt, date, minutes, status,
      reason, recordId, clockSkewMinutes: skew, receivedAt: now.toISOString(),
    }).run()
    return { clientId: item.clientId, status, reason }
  }

  const employee = db.select().from(employees).where(eq(employees.id, item.employeeId)).get()
  if (!employee || (employee.facilityId !== facilityId && !helperIdsOn(db, facilityId, date).includes(employee.id))) {
    return finish('rejected', 'employee_not_found', null)
  }
  const openWrongPins = db.select({ n: count() }).from(offlineStamps).where(and(
    eq(offlineStamps.employeeId, employee.id), eq(offlineStamps.reason, 'pin_invalid'), isNull(offlineStamps.checkedAt),
  )).get()!.n
  if (openWrongPins >= OFFLINE_MAX_OPEN_WRONG_PINS) return finish('rejected', 'pin_blocked', employee.id)
  if (employee.pinHash === null) return finish('rejected', 'pin_missing', employee.id)
  if (!verifyPassword(item.pin, employee.pinHash)) return finish('rejected', 'pin_invalid', employee.id)
  const timeCheck = offlineStampTimeCheck(at, now)
  if (timeCheck !== 'ok') return finish('rejected', timeCheck, employee.id)
  if (!isEmployedOn(loadEmployee(db, employee.id)!.info, date)) return finish('rejected', 'not_employed', employee.id)
  if (activeTrackingFrom(db, employee.facilityId, date) === null) return finish('rejected', 'time_tracking_off', employee.id)

  const day = db.select().from(timeRecords).where(and(eq(timeRecords.employeeId, employee.id), eq(timeRecords.date, date))).all()
  const open = day.find(record => record.end === null)
  if (item.action === 'in') {
    if (open) return finish('review', 'already_clocked_in', employee.id)
    if (day.some(record => (record.end ?? DAY_END) > minutes)) return finish('review', 'overlap', employee.id)
    const record = db.insert(timeRecords).values({
      employeeId: employee.id, date, start: minutes, end: null, source: 'terminal', createdAt: now.toISOString(),
      offline: true, clockSkewMinutes: skew,
    }).returning({ id: timeRecords.id }).get()
    return finish('recorded', null, employee.id, record.id)
  }
  if (!open || open.start > minutes) return finish('review', 'not_clocked_in', employee.id)
  db.update(timeRecords).set({ end: minutes, offline: true, clockSkewMinutes: skew ?? open.clockSkewMinutes })
    .where(eq(timeRecords.id, open.id)).run()
  return finish('recorded', null, employee.id, open.id)
}

/** The facility's employees' offline stamps not taken over and not checked yet, oldest first (review list). */
export function listOfflineStampHints(db: Db, facilityId: number): OfflineStampHintDto[] {
  return db.select({ stamp: offlineStamps, name: employees.name }).from(offlineStamps)
    .innerJoin(employees, eq(offlineStamps.employeeId, employees.id))
    .where(and(
      eq(employees.facilityId, facilityId), isNull(offlineStamps.checkedAt),
      inArray(offlineStamps.reason, [...OFFLINE_HINT_REASONS]),
    ))
    .orderBy(asc(offlineStamps.date), asc(offlineStamps.minutes), asc(offlineStamps.id))
    .all()
    .map(({ stamp, name }) => ({
      id: stamp.id, employeeId: stamp.employeeId!, name, action: stamp.action, date: stamp.date, minutes: stamp.minutes,
      reason: stamp.reason as OfflineStampReason, clockSkewMinutes: stamp.clockSkewMinutes, receivedAt: stamp.receivedAt,
    }))
}

/** „Geprüft“ on the review list: the hint goes (an entry of another facility's employee is offline_stamp_not_found). */
export function checkOfflineStampHint(db: Db, actor: SessionUser, facilityId: number, id: number, now: Date = new Date()): void {
  const row = db.select({ id: offlineStamps.id, checkedAt: offlineStamps.checkedAt }).from(offlineStamps)
    .innerJoin(employees, eq(offlineStamps.employeeId, employees.id))
    .where(and(eq(offlineStamps.id, id), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'offline_stamp_not_found')
  if (row.checkedAt !== null) return
  db.update(offlineStamps).set({ checkedAt: now.toISOString(), checkedBy: actor.id }).where(eq(offlineStamps.id, id)).run()
}

/**
 * The box „Erinnerungen“: for Leitung and Träger in the office (time.manage, not at the tablet) one entry per hint of
 * the review list, until checked on the time page.
 */
export function offlineStampReminders(
  db: Db, viewer: { facilityId: number; permissions: ReadonlySet<PermissionKey>; onTablet: boolean }, today: IsoDate,
): ReminderDto[] {
  if (!can(viewer.permissions, 'time.manage') || viewer.onTablet) return []
  return listOfflineStampHints(db, viewer.facilityId).map(hint => ({
    kind: 'offlineStamp' as const, date: hint.date, state: hint.date < today ? 'overdue' as const : 'today' as const,
    name: hint.name, childId: null, age: null, ownChild: false, canDone: false, time: hint.minutes, meetingKind: null,
    count: null, offlineStamp: { id: hint.id, employeeId: hint.employeeId, action: hint.action, reason: hint.reason },
  }))
}
