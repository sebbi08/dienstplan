import { and, eq, isNull } from 'drizzle-orm'
import { isEmployedOn } from '../../shared/domain/targets'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { StampAction, TerminalPersonDto, TimeRecordDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, timeRecords } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { loadEmployees } from './queries'
import { stamp } from './timeTracking'

export const MAX_PIN_ATTEMPTS = 5
export const PIN_LOCK_MINUTES = 15

function findEmployee(db: Db, employeeId: number) {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  return employee
}

export function setPin(db: Db, employeeId: number, pin: string): void {
  findEmployee(db, employeeId)
  if (!/^\d{4}$/.test(pin)) throw new ServiceError(400, 'pin_format')
  db.update(employees).set({ pinHash: hashPassword(pin), pinFailed: 0, pinLockedUntil: null }).where(eq(employees.id, employeeId)).run()
}

export function clearPin(db: Db, employeeId: number): void {
  findEmployee(db, employeeId)
  db.update(employees).set({ pinHash: null, pinFailed: 0, pinLockedUntil: null }).where(eq(employees.id, employeeId)).run()
}

/** People shown on the tablet: employed today and with a PIN; clockedIn = open record today. */
export function terminalStatus(db: Db, now: Date = new Date()): TerminalPersonDto[] {
  const { date } = nowInBerlin(now)
  const withPin = new Set(db.select().from(employees).all().filter(row => row.pinHash !== null).map(row => row.id))
  const open = new Set(db.select().from(timeRecords)
    .where(and(eq(timeRecords.date, date), isNull(timeRecords.end))).all().map(record => record.employeeId))
  return loadEmployees(db)
    .filter(employee => withPin.has(employee.id) && isEmployedOn(employee.info, date))
    .map(employee => ({ employeeId: employee.id, name: employee.name, clockedIn: open.has(employee.id) }))
}

/** Checks the PIN (5 wrong attempts lock the person for 15 minutes) and stamps as "terminal". */
export function terminalStamp(db: Db, employeeId: number, pin: string, action: StampAction, now: Date = new Date()): TimeRecordDto {
  const employee = findEmployee(db, employeeId)
  const info = loadEmployees(db).find(candidate => candidate.id === employeeId)!.info
  if (!isEmployedOn(info, nowInBerlin(now).date)) throw new ServiceError(400, 'employee_not_employed')
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
