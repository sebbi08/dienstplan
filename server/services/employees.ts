import { and, asc, eq } from 'drizzle-orm'
import { weeklyMinutesOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { EmployeeDetailDto, EmployeeListItemDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { balanceAdjustments, employeeHours, employees, leaveEntitlements } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadEmployees, type EmployeeRecord } from './queries'

export interface EmployeeInput {
  name: string
  shortName: string
  weeklyMinutes: number
  validFrom: IsoDate
}

export interface EmployeeUpdate {
  name: string
  shortName: string
  leftOn: IsoDate | null
}

function toListItem(employee: EmployeeRecord, today: IsoDate): EmployeeListItemDto {
  return {
    id: employee.id, name: employee.name, shortName: employee.shortName,
    sortOrder: employee.sortOrder, leftOn: employee.leftOn,
    currentWeeklyMinutes: weeklyMinutesOn(employee.info, today) ?? employee.info.hours[0]?.weeklyMinutes ?? null,
  }
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'name_required')
  return trimmed
}

function assertEmployee(db: Db, id: number): void {
  if (!db.select().from(employees).where(eq(employees.id, id)).get()) throw new ServiceError(404, 'employee_not_found')
}

export function listEmployees(db: Db, today: IsoDate): EmployeeListItemDto[] {
  return loadEmployees(db).map(employee => toListItem(employee, today))
}

export function getEmployee(db: Db, id: number, today: IsoDate): EmployeeDetailDto {
  const employee = loadEmployees(db).find(candidate => candidate.id === id)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  return {
    ...toListItem(employee, today),
    hours: db.select().from(employeeHours).where(eq(employeeHours.employeeId, id)).orderBy(asc(employeeHours.validFrom)).all()
      .map(({ id: hoursId, weeklyMinutes, validFrom }) => ({ id: hoursId, weeklyMinutes, validFrom })),
    adjustments: db.select().from(balanceAdjustments).where(eq(balanceAdjustments.employeeId, id)).orderBy(asc(balanceAdjustments.date)).all()
      .map(({ id: adjustmentId, date, minutes, reason }) => ({ id: adjustmentId, date, minutes, reason })),
    entitlements: db.select().from(leaveEntitlements).where(eq(leaveEntitlements.employeeId, id)).orderBy(asc(leaveEntitlements.year)).all()
      .map(({ id: entitlementId, year, days, carriedOverDays }) => ({ id: entitlementId, year, days, carriedOverDays })),
    hasPin: db.select().from(employees).where(eq(employees.id, id)).get()!.pinHash !== null,
  }
}

export function createEmployee(db: Db, input: EmployeeInput): number {
  const name = requireName(input.name)
  return db.transaction((tx) => {
    const sortOrder = Math.max(0, ...tx.select().from(employees).all().map(e => e.sortOrder)) + 1
    const employee = tx.insert(employees).values({ name, shortName: input.shortName.trim(), sortOrder }).returning().get()
    tx.insert(employeeHours).values({ employeeId: employee.id, weeklyMinutes: input.weeklyMinutes, validFrom: input.validFrom }).run()
    return employee.id
  })
}

export function updateEmployee(db: Db, id: number, update: EmployeeUpdate): void {
  assertEmployee(db, id)
  db.update(employees)
    .set({ name: requireName(update.name), shortName: update.shortName.trim(), leftOn: update.leftOn })
    .where(eq(employees.id, id)).run()
}

export function moveEmployee(db: Db, id: number, direction: 'up' | 'down'): void {
  const ordered = loadEmployees(db)
  const index = ordered.findIndex(employee => employee.id === id)
  if (index === -1) throw new ServiceError(404, 'employee_not_found')
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= ordered.length) return
  ;[ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]
  db.transaction((tx) => {
    ordered.forEach((employee, position) => {
      tx.update(employees).set({ sortOrder: position + 1 }).where(eq(employees.id, employee.id)).run()
    })
  })
}

export function addHours(db: Db, employeeId: number, period: { weeklyMinutes: number; validFrom: IsoDate }): void {
  assertEmployee(db, employeeId)
  db.insert(employeeHours).values({ employeeId, ...period })
    .onConflictDoUpdate({ target: [employeeHours.employeeId, employeeHours.validFrom], set: { weeklyMinutes: period.weeklyMinutes } })
    .run()
}

export function deleteHours(db: Db, id: number): void {
  const period = db.select().from(employeeHours).where(eq(employeeHours.id, id)).get()
  if (!period) throw new ServiceError(404, 'hours_not_found')
  const count = db.select().from(employeeHours).where(eq(employeeHours.employeeId, period.employeeId)).all().length
  if (count <= 1) throw new ServiceError(409, 'last_hours')
  db.delete(employeeHours).where(eq(employeeHours.id, id)).run()
}

export function addAdjustment(db: Db, employeeId: number, adjustment: { date: IsoDate; minutes: number; reason: string }): void {
  assertEmployee(db, employeeId)
  const reason = adjustment.reason.trim()
  if (!reason) throw new ServiceError(400, 'reason_required')
  db.insert(balanceAdjustments).values({ employeeId, date: adjustment.date, minutes: adjustment.minutes, reason }).run()
}

export function deleteAdjustment(db: Db, id: number): void {
  db.delete(balanceAdjustments).where(eq(balanceAdjustments.id, id)).run()
}

export function setEntitlement(
  db: Db, employeeId: number, year: number, value: { days: number; carriedOverDays: number },
): void {
  assertEmployee(db, employeeId)
  const existing = db.select().from(leaveEntitlements)
    .where(and(eq(leaveEntitlements.employeeId, employeeId), eq(leaveEntitlements.year, year))).get()
  if (existing) {
    db.update(leaveEntitlements).set(value).where(eq(leaveEntitlements.id, existing.id)).run()
  }
  else {
    db.insert(leaveEntitlements).values({ employeeId, year, ...value }).run()
  }
}
