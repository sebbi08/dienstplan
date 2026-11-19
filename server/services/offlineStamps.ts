import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import {
  clockSkewMinutes, OFFLINE_HINT_REASONS, OFFLINE_MAX_OPEN_HINTS, OFFLINE_PIN_CHECKS_MAX, OFFLINE_REQUESTS_PER_MINUTE,
  offlineStampTimeCheck, type OfflineStampReason, type OfflineStampStatus,
} from '../../shared/domain/offlineStamps'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { pinLockState } from '../../shared/domain/pin'
import { isEmployedOn } from '../../shared/domain/targets'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { OfflineStampHintDto, OfflineStampInputDto, ReminderDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, offlineStamps, timeRecords } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom } from './appSettings'
import { loadEmployee } from './queries'
import { helperIdsOn, verifyEmployeePin } from './terminal'

export type OfflineStampInput = OfflineStampInputDto

/** What became of one stamp (the tablet only learns done/rejected, see `tabletStatus`). */
export interface OfflineStampOutcome {
  clientId: string
  status: OfflineStampStatus
  reason: OfflineStampReason | null
}

/** The end of the day for an open record when looking for overlaps. */
const DAY_END = 24 * 60

type PinResult = 'ok' | 'invalid' | 'missing' | 'locked'

/** Per request: PIN results by person and PIN (one scrypt per person and PIN), and the PIN checks left. */
interface SyncContext {
  facilityId: number
  skew: number | null
  now: Date
  pins: Map<string, PinResult>
  checksLeft: number
}

/** The PIN check could not run in this request (too many checks): the stamp stays in the tablet's queue. */
const DEFERRED = Symbol('deferred')

/**
 * Takes over the stamps of the tablet's offline queue, in the order sent (docs/BETRIEB.md „Stempeln ohne Netz am
 * Tablet“). Per stamp, cheapest checks first:
 *   1. a client id already known answers `duplicate` and changes nothing;
 *   2. the time: at most 5 minutes ahead of the server (plus the tablet's known lead, at most 60 minutes), at most 7
 *      days old, never a day after the server's today;
 *   3. the person: the tablet's own staff (by the server's data), or a helper planned here on the stamp's day, which
 *      step 2 keeps within the last 7 days; anybody else is refused without being stored;
 *   4. a time outside the window is refused now, with a hint (no PIN check);
 *   5. employed and time tracking on that day (refused without hint);
 *   6. the PIN with the normal rules: a locked PIN is not checked (`pin_locked`); a wrong one counts toward the lock
 *      like a wrong try at the tablet (the same wrong PIN of a person counts once per request); a right one resets it;
 *   7. the records: a stamp matching a recorded Kommt or Geht (±1 minute) is taken as already there; a Kommt opens a
 *      record when nothing of the day is open or ends later; a Geht closes the day's open record begun before it;
 *      otherwise the stamp goes to the review list. A time later than the server's now (within the tolerance) is
 *      taken as now.
 * Taken-over stamps mark the record „offline erfasst“ and, when the tablet's clock (`clientNow`) is more than 5 minutes
 * off, with the difference. A stamp the server fails to handle goes to the review list (`failed`) and does not hold
 * up the others. At most 20 PIN checks per request: the stamps from the first one beyond are left out of the answer and
 * stay queued, in order. Every stamp of a known person is stored by its client id (never the PIN).
 */
export function syncOfflineStamps(
  db: Db, facilityId: number, input: { clientNow: string; stamps: OfflineStampInput[] }, now: Date = new Date(),
): { results: OfflineStampOutcome[] } {
  const context: SyncContext = {
    facilityId, skew: clockSkewMinutes(new Date(input.clientNow), now), now, pins: new Map(), checksLeft: OFFLINE_PIN_CHECKS_MAX,
  }
  const results: OfflineStampOutcome[] = []
  for (const item of input.stamps) {
    let outcome: OfflineStampOutcome | typeof DEFERRED | null
    try {
      outcome = db.transaction(tx => takeOver(tx, context, item))
    }
    catch (error) {
      console.error(`Offline stamp ${item.clientId} could not be handled`, error)
      outcome = storeFailure(db, context, item)
    }
    if (outcome === DEFERRED) break
    if (outcome) results.push(outcome)
  }
  return { results }
}

/** A stamp that failed: on the review list when it can still be stored, otherwise left in the tablet's queue. */
function storeFailure(db: Db, context: SyncContext, item: OfflineStampInput): OfflineStampOutcome | null {
  try {
    const employee = db.select({ id: employees.id, facilityId: employees.facilityId }).from(employees)
      .where(eq(employees.id, item.employeeId)).get()
    if (!employee || employee.facilityId !== context.facilityId) return null
    const known = db.select({ id: offlineStamps.id }).from(offlineStamps).where(eq(offlineStamps.clientId, item.clientId)).get()
    if (known) return { clientId: item.clientId, status: 'duplicate', reason: null }
    const { date, minutes } = nowInBerlin(new Date(item.stampedAt))
    db.insert(offlineStamps).values({
      clientId: item.clientId, facilityId: context.facilityId, employeeId: employee.id, action: item.action, stampedAt: item.stampedAt,
      date, minutes, status: 'review', reason: 'failed', clockSkewMinutes: context.skew, receivedAt: context.now.toISOString(),
    }).run()
    return { clientId: item.clientId, status: 'review', reason: 'failed' }
  }
  catch (error) {
    console.error(`Offline stamp ${item.clientId} could not be stored`, error)
    return null
  }
}

/** Open hints of the person (all, or of one reason). */
function openHints(db: Db, employeeId: number, reason?: OfflineStampReason): number {
  return db.select({ n: count() }).from(offlineStamps).where(and(
    eq(offlineStamps.employeeId, employeeId), isNull(offlineStamps.checkedAt),
    reason ? eq(offlineStamps.reason, reason) : inArray(offlineStamps.reason, [...OFFLINE_HINT_REASONS]),
  )).get()!.n
}

/** The PIN with the normal rules (lock respected, wrong tries counted), once per person and PIN in a request. */
function checkPin(db: Db, context: SyncContext, employee: typeof employees.$inferSelect, pin: string): PinResult | typeof DEFERRED {
  const key = `${employee.id}:${pin}`
  const known = context.pins.get(key)
  if (known) return known
  const lock = pinLockState(employee, context.now)
  if (lock.pinLockedPermanently || lock.pinLockedUntil !== null) return 'locked'
  if (employee.pinHash === null) return 'missing'
  if (context.checksLeft <= 0) return DEFERRED
  context.checksLeft--
  let result: PinResult = 'ok'
  try {
    verifyEmployeePin(db, employee.id, pin, context.now)
  }
  catch (error) {
    if (!(error instanceof ServiceError)) throw error
    result = error.code === 'pin_invalid' ? 'invalid' : error.code === 'pin_missing' ? 'missing' : 'locked'
    // The try that locked the PIN was itself wrong.
    if (result === 'locked' && (error.details as { newLock?: boolean } | undefined)?.newLock) result = 'invalid'
  }
  context.pins.set(key, result)
  return result
}

function takeOver(db: Db, context: SyncContext, item: OfflineStampInput): OfflineStampOutcome | typeof DEFERRED | null {
  const { facilityId, skew, now } = context
  const known = db.select({ id: offlineStamps.id }).from(offlineStamps).where(eq(offlineStamps.clientId, item.clientId)).get()
  if (known) return { clientId: item.clientId, status: 'duplicate', reason: null }
  const at = new Date(item.stampedAt)
  const { date, minutes: tapped } = nowInBerlin(at)
  const current = nowInBerlin(now)
  const timeCheck = date > current.date ? 'in_future' : offlineStampTimeCheck(at, now, skew)

  const employee = db.select().from(employees).where(eq(employees.id, item.employeeId)).get()
  const own = employee?.facilityId === facilityId
  // A helper only on a day of the time window (the date is checked before it is used).
  const helper = !own && employee !== undefined && timeCheck === 'ok' && helperIdsOn(db, facilityId, date).includes(employee.id)
  if (!employee || (!own && !helper)) return { clientId: item.clientId, status: 'rejected', reason: 'employee_not_found' }

  const finish = (
    status: Exclude<OfflineStampStatus, 'duplicate'>, reason: OfflineStampReason | null, recordId: number | null = null,
  ): OfflineStampOutcome => {
    // Bounded review list: one open „PIN gesperrt“ per person, at most 20 open hints per person; further ones are logged
    // as checked.
    const hint = reason !== null && OFFLINE_HINT_REASONS.includes(reason)
    const surplus = hint && (openHints(db, employee.id) >= OFFLINE_MAX_OPEN_HINTS || (reason === 'pin_locked' && openHints(db, employee.id, 'pin_locked') > 0))
    db.insert(offlineStamps).values({
      clientId: item.clientId, facilityId, employeeId: employee.id, action: item.action, stampedAt: item.stampedAt, date, minutes: tapped,
      status, reason, recordId, clockSkewMinutes: skew, receivedAt: now.toISOString(), checkedAt: surplus ? now.toISOString() : null,
    }).run()
    return { clientId: item.clientId, status, reason }
  }

  if (timeCheck !== 'ok') return finish('rejected', timeCheck)
  if (!isEmployedOn(loadEmployee(db, employee.id)!.info, date)) return finish('rejected', 'not_employed')
  if (activeTrackingFrom(db, employee.facilityId, date) === null) return finish('rejected', 'time_tracking_off')
  const pin = checkPin(db, context, employee, item.pin)
  if (pin === DEFERRED) return DEFERRED
  if (pin === 'locked') return finish('rejected', 'pin_locked')
  if (pin === 'missing') return finish('rejected', 'pin_missing')
  if (pin === 'invalid') return finish('rejected', 'pin_invalid')

  // Never a time after the server's now (within the tolerance the tap may lie a little ahead).
  const minutes = date === current.date ? Math.min(tapped, current.minutes) : tapped
  const day = db.select().from(timeRecords).where(and(eq(timeRecords.employeeId, employee.id), eq(timeRecords.date, date))).all()
  // Sent again after an answer got lost (e.g. the online stamp went through but its answer did not): already there.
  const same = day.find(record => Math.abs((item.action === 'in' ? record.start : record.end ?? -10) - minutes) <= 1)
  if (same) return finish('recorded', null, same.id)
  const open = day.find(record => record.end === null)
  if (item.action === 'in') {
    if (open) return finish('review', 'already_clocked_in')
    if (day.some(record => (record.end ?? DAY_END) > minutes)) return finish('review', 'overlap')
    const record = db.insert(timeRecords).values({
      employeeId: employee.id, date, start: minutes, end: null, source: 'terminal', createdAt: now.toISOString(),
      offline: true, clockSkewMinutes: skew,
    }).returning({ id: timeRecords.id }).get()
    return finish('recorded', null, record.id)
  }
  if (!open || open.start > minutes) return finish('review', 'not_clocked_in')
  db.update(timeRecords).set({ end: minutes, offline: true, clockSkewMinutes: skew ?? open.clockSkewMinutes })
    .where(eq(timeRecords.id, open.id)).run()
  return finish('recorded', null, open.id)
}

/** Requests per tablet account in the last minute (in memory; a restart forgets them). */
const recentRequests = new Map<number, number[]>()

/** Whether the tablet account may send another batch now: at most 10 requests per minute. */
export function allowOfflineSync(accountId: number, now: Date = new Date()): boolean {
  const since = now.getTime() - 60_000
  const recent = (recentRequests.get(accountId) ?? []).filter(time => time > since)
  const allowed = recent.length < OFFLINE_REQUESTS_PER_MINUTE
  if (allowed) recent.push(now.getTime())
  recentRequests.set(accountId, recent)
  return allowed
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
