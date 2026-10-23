import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES, PIN_PERMANENT_LOCK_LEVEL, isValidPin, pinLockCode, pinLockState } from '../../shared/domain/pin'
import { isEmployedOn } from '../../shared/domain/targets'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { StampAction, TerminalPersonDto, TimeRecordDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, entries, timeRecords } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { activeTrackingFrom } from './appSettings'
import { loadEmployee, loadEmployees } from './queries'
import { stamp } from './timeTracking'

/** Everything back to "no wrong try": a right PIN, a new PIN, a cleared PIN and the managers' unlock. */
const PIN_RESET = { pinFailed: 0, pinLockedUntil: null, pinLockLevel: 0 }

/**
 * The employee, if it belongs to the facility; otherwise employee_not_found (other facilities stay unconfirmed).
 * Home staff only: PINs are managed by the home facility, helpers included.
 */
function findEmployee(db: Db, facilityId: number, employeeId: number) {
  const employee = db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, facilityId))).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  return employee
}

/** Sets the PIN (exactly six digits, pin_format otherwise); a new PIN also ends every lock. */
export function setPin(db: Db, facilityId: number, employeeId: number, pin: string): void {
  findEmployee(db, facilityId, employeeId)
  if (!isValidPin(pin)) throw new ServiceError(400, 'pin_format')
  db.update(employees).set({ pinHash: hashPassword(pin), ...PIN_RESET }).where(eq(employees.id, employeeId)).run()
}

export function clearPin(db: Db, facilityId: number, employeeId: number): void {
  findEmployee(db, facilityId, employeeId)
  db.update(employees).set({ pinHash: null, ...PIN_RESET }).where(eq(employees.id, employeeId)).run()
}

/** The managers' „PIN freischalten“: ends a lock (also the lasting one) and starts the escalation again at 15 minutes. */
export function unlockPin(db: Db, facilityId: number, employeeId: number): void {
  findEmployee(db, facilityId, employeeId)
  db.update(employees).set(PIN_RESET).where(eq(employees.id, employeeId)).run()
}

/** Ids of the employees planned in the facility's helper column (help-out entry) on the date. */
function helperIdsOn(db: Db, facilityId: number, date: string): number[] {
  return [...new Set(db.select({ employeeId: entries.employeeId }).from(entries)
    .where(and(eq(entries.helpFacilityId, facilityId), eq(entries.date, date))).all().map(row => row.employeeId))]
}

/**
 * People shown on the facility's tablet: employed today and with a PIN; clockedIn = open record today.
 * Helpers with a help-out entry in the facility today are listed after the own staff, when their home facility tracks
 * time today (their records live there; otherwise stamping would be refused).
 */
export function terminalStatus(db: Db, facilityId: number, now: Date = new Date()): TerminalPersonDto[] {
  const { date } = nowInBerlin(now)
  const helpers = helperIdsOn(db, facilityId, date).flatMap(id => loadEmployee(db, id) ?? [])
    .filter(helper => helper.facilityId !== facilityId && activeTrackingFrom(db, helper.facilityId, date) !== null)
  const staff = [...loadEmployees(db, facilityId), ...helpers]
  const withPin = new Set(staff.length === 0
    ? []
    : db.select({ id: employees.id }).from(employees)
        .where(and(inArray(employees.id, staff.map(employee => employee.id)), isNotNull(employees.pinHash))).all()
        .map(row => row.id))
  const open = new Set(db.select().from(timeRecords)
    .where(and(eq(timeRecords.date, date), isNull(timeRecords.end))).all().map(record => record.employeeId))
  return staff
    .filter(employee => withPin.has(employee.id) && isEmployedOn(employee.info, date))
    .map(employee => ({ employeeId: employee.id, name: employee.name, clockedIn: open.has(employee.id) }))
}

/**
 * Checks the employee's PIN: pin_missing without one, pin_invalid when wrong (details.remaining = tries left before the
 * lock). Every fifth wrong attempt in a row locks the PIN, longer each time: 15 minutes (pin_locked), 30 minutes
 * (pin_locked_long), then until the Leitung or the Träger unlocks it (pin_locked_permanent); while locked, the lock's
 * code is returned without looking at the PIN. details.lockedUntil is the end of a timed lock (null = lasting), and
 * details.newLock tells whether this try locked it (the tablet names the lock time then, later its end). A right PIN
 * resets the attempts and the lock level. Stamping and unlocking the child records count together. The caller has
 * checked that the person belongs to this tablet.
 */
export function verifyEmployeePin(db: Db, employeeId: number, pin: string, now: Date): void {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  if (employee.pinHash === null) throw new ServiceError(400, 'pin_missing')
  const lock = pinLockState(employee, now)
  if (lock.pinLockedPermanently || lock.pinLockedUntil !== null) {
    throw new ServiceError(423, pinLockCode(employee.pinLockLevel), { lockedUntil: lock.pinLockedUntil, newLock: false })
  }
  if (!verifyPassword(pin, employee.pinHash)) {
    const failed = employee.pinFailed + 1
    if (failed >= MAX_PIN_ATTEMPTS) {
      const level = Math.min(employee.pinLockLevel + 1, PIN_PERMANENT_LOCK_LEVEL)
      const minutes = PIN_LOCK_MINUTES[level - 1]
      const pinLockedUntil = minutes === undefined ? null : new Date(now.getTime() + minutes * 60_000).toISOString()
      db.update(employees).set({ pinFailed: 0, pinLockedUntil, pinLockLevel: level }).where(eq(employees.id, employeeId)).run()
      throw new ServiceError(423, pinLockCode(level), { lockedUntil: pinLockedUntil, newLock: true })
    }
    db.update(employees).set({ pinFailed: failed }).where(eq(employees.id, employeeId)).run()
    throw new ServiceError(401, 'pin_invalid', { remaining: MAX_PIN_ATTEMPTS - failed })
  }
  if (employee.pinFailed !== 0 || employee.pinLockedUntil !== null || employee.pinLockLevel !== 0) {
    db.update(employees).set(PIN_RESET).where(eq(employees.id, employeeId)).run()
  }
}

/**
 * Checks the PIN (with the escalating lock of verifyEmployeePin) and stamps as "terminal". Only the facility's
 * employees, and helpers on the days they are planned here: anyone else is employee_not_found before the PIN is looked
 * at, so no attempt is counted. Employment is checked against the person's own record.
 */
export function terminalStamp(
  db: Db, facilityId: number, employeeId: number, pin: string, action: StampAction, now: Date = new Date(),
): TimeRecordDto {
  const { date } = nowInBerlin(now)
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get()
  const isHome = employee?.facilityId === facilityId
  if (!employee || (!isHome && !helperIdsOn(db, facilityId, date).includes(employeeId))) {
    throw new ServiceError(404, 'employee_not_found')
  }
  const info = loadEmployee(db, employeeId)!.info
  if (!isEmployedOn(info, date)) throw new ServiceError(400, 'employee_not_employed')
  verifyEmployeePin(db, employeeId, pin, now)
  return stamp(db, employeeId, action, 'terminal', now)
}
