import { and, eq, isNull } from 'drizzle-orm'
import { isEmployedOn } from '../../shared/domain/targets'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { StampAction, TerminalPersonDto, TimeRecordDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, entries, timeRecords } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { loadEmployee, loadEmployees } from './queries'
import { stamp } from './timeTracking'

export const MAX_PIN_ATTEMPTS = 5
export const PIN_LOCK_MINUTES = 15

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

export function setPin(db: Db, facilityId: number, employeeId: number, pin: string): void {
  findEmployee(db, facilityId, employeeId)
  if (!/^\d{4}$/.test(pin)) throw new ServiceError(400, 'pin_format')
  db.update(employees).set({ pinHash: hashPassword(pin), pinFailed: 0, pinLockedUntil: null }).where(eq(employees.id, employeeId)).run()
}

export function clearPin(db: Db, facilityId: number, employeeId: number): void {
  findEmployee(db, facilityId, employeeId)
  db.update(employees).set({ pinHash: null, pinFailed: 0, pinLockedUntil: null }).where(eq(employees.id, employeeId)).run()
}

/** Ids of the employees planned in the facility's helper column (help-out entry) on the date. */
function helperIdsOn(db: Db, facilityId: number, date: string): number[] {
  return [...new Set(db.select({ employeeId: entries.employeeId }).from(entries)
    .where(and(eq(entries.helpFacilityId, facilityId), eq(entries.date, date))).all().map(row => row.employeeId))]
}

/**
 * People shown on the facility's tablet: employed today and with a PIN; clockedIn = open record today.
 * Helpers with a help-out entry in the facility today are listed after the own staff.
 */
export function terminalStatus(db: Db, facilityId: number, now: Date = new Date()): TerminalPersonDto[] {
  const { date } = nowInBerlin(now)
  const helpers = helperIdsOn(db, facilityId, date).flatMap(id => loadEmployee(db, id) ?? [])
    .filter(helper => helper.facilityId !== facilityId)
  const staff = [...loadEmployees(db, facilityId), ...helpers]
  const withPin = new Set(db.select().from(employees).all().filter(row => row.pinHash !== null).map(row => row.id))
  const open = new Set(db.select().from(timeRecords)
    .where(and(eq(timeRecords.date, date), isNull(timeRecords.end))).all().map(record => record.employeeId))
  return staff
    .filter(employee => withPin.has(employee.id) && isEmployedOn(employee.info, date))
    .map(employee => ({ employeeId: employee.id, name: employee.name, clockedIn: open.has(employee.id) }))
}

/**
 * Checks the PIN (5 wrong attempts lock the person for 15 minutes) and stamps as "terminal". Only the facility's
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
  if (employee.pinHash === null) throw new ServiceError(400, 'pin_missing')
  if (employee.pinLockedUntil && employee.pinLockedUntil > now.toISOString()) throw new ServiceError(423, 'pin_locked')
  if (!verifyPassword(pin, employee.pinHash)) {
    const failed = employee.pinFailed + 1
    if (failed >= MAX_PIN_ATTEMPTS) {
      const pinLockedUntil = new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000).toISOString()
      db.update(employees).set({ pinFailed: 0, pinLockedUntil }).where(eq(employees.id, employeeId)).run()
      throw new ServiceError(423, 'pin_locked')
    }
    db.update(employees).set({ pinFailed: failed }).where(eq(employees.id, employeeId)).run()
    throw new ServiceError(401, 'pin_invalid')
  }
  db.update(employees).set({ pinFailed: 0, pinLockedUntil: null }).where(eq(employees.id, employeeId)).run()
  return stamp(db, employeeId, action, 'terminal', now)
}
