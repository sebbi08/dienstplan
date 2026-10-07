import { and, asc, eq, ne } from 'drizzle-orm'
import { parseIsoDate } from '../../shared/domain/dates'
import type { BreakMode, StampChannel } from '../../shared/domain/stamping'
import { MONDAY_TO_FRIDAY, weeklyMinutesOn, workdaysOn } from '../../shared/domain/targets'
import { dueLevelUp, type JobKey, type PayGroup } from '../../shared/domain/tvoed'
import type { IsoDate } from '../../shared/domain/types'
import type { EmployeeContractDto, EmployeeDetailDto, EmployeeListItemDto, LevelUpDto, Role, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { balanceAdjustments, employeeHours, employees, leaveEntitlements } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { contractVisibleToAdmins } from './appSettings'
import { bookClosuresFor } from './closures'
import { loadEmployees, type EmployeeRecord } from './queries'

export interface EmployeeInput {
  name: string
  shortName: string
  weeklyMinutes: number
  validFrom: IsoDate
  /** Working days bitmask (bit 0 = Monday); default Monday–Friday. */
  workdays?: number
  /** Leave entitlement for the year of validFrom. */
  vacationDays?: number | null
  /** Remaining leave carried over into that year. */
  carriedOverDays?: number | null
  /** Where to clock in and out and how breaks count (default: both, breaks clocked). */
  stampVia?: StampChannel
  breakMode?: BreakMode
  /** Existing overtime (or minus hours) when the employee is added, booked on validFrom. */
  openingBalanceMinutes?: number | null
}

/** Reason of the balance booking created together with a new employee. */
export const OPENING_BALANCE_REASON = 'Übertrag bei Anlage'

function requireWorkdays(workdays: number): number {
  if (workdays <= 0 || workdays > 127) throw new ServiceError(400, 'workdays_required')
  return workdays
}

export interface EmployeeUpdate {
  name: string
  shortName: string
  leftOn: IsoDate | null
}

/** Contract data for this viewer: always for the Träger, for the Leitung only when the Träger allows it. */
function mayViewContract(db: Db, viewer: Role): boolean {
  return viewer === 'provider' || (viewer === 'admin' && contractVisibleToAdmins(db))
}

function contractOf(employee: EmployeeRecord): EmployeeContractDto {
  return {
    personnelNumber: employee.personnelNumber,
    employedSince: employee.employedSince, jobKey: employee.jobKey as JobKey | null, jobOther: employee.jobOther,
    payGroup: employee.payGroup as PayGroup | null, payLevel: employee.payLevel,
  }
}

function toListItem(employee: EmployeeRecord, today: IsoDate, withContract: boolean): EmployeeListItemDto {
  return {
    id: employee.id, name: employee.name, shortName: employee.shortName,
    sortOrder: employee.sortOrder, leftOn: employee.leftOn,
    currentWeeklyMinutes: weeklyMinutesOn(employee.info, today) ?? employee.info.hours[0]?.weeklyMinutes ?? null,
    currentWorkdays: weeklyMinutesOn(employee.info, today) !== null
      ? workdaysOn(employee.info, today)
      : employee.info.hours[0]?.workdays ?? MONDAY_TO_FRIDAY,
    stampVia: employee.stampVia, breakMode: employee.breakMode,
    ...(withContract ? { contract: contractOf(employee) } : {}),
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

export function listEmployees(db: Db, today: IsoDate, viewer: Role): EmployeeListItemDto[] {
  const withContract = mayViewContract(db, viewer)
  return loadEmployees(db).map(employee => toListItem(employee, today, withContract))
}

export function getEmployee(db: Db, id: number, today: IsoDate, viewer: Role): EmployeeDetailDto {
  const employee = loadEmployees(db).find(candidate => candidate.id === id)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  return {
    ...toListItem(employee, today, mayViewContract(db, viewer)),
    hours: db.select().from(employeeHours).where(eq(employeeHours.employeeId, id)).orderBy(asc(employeeHours.validFrom)).all()
      .map(({ id: hoursId, weeklyMinutes, validFrom, workdays }) => ({ id: hoursId, weeklyMinutes, validFrom, workdays })),
    adjustments: db.select().from(balanceAdjustments).where(eq(balanceAdjustments.employeeId, id)).orderBy(asc(balanceAdjustments.date)).all()
      .map(({ id: adjustmentId, date, minutes, reason }) => ({ id: adjustmentId, date, minutes, reason })),
    entitlements: db.select().from(leaveEntitlements).where(eq(leaveEntitlements.employeeId, id)).orderBy(asc(leaveEntitlements.year)).all()
      .map(({ id: entitlementId, year, days, carriedOverDays }) => ({ id: entitlementId, year, days, carriedOverDays })),
    hasPin: db.select().from(employees).where(eq(employees.id, id)).get()!.pinHash !== null,
  }
}

/** Creates an employee; existing closures are booked for them right away (closures apply to everyone). */
export function createEmployee(db: Db, actor: SessionUser, input: EmployeeInput, now: Date = new Date()): number {
  const name = requireName(input.name)
  const workdays = requireWorkdays(input.workdays ?? MONDAY_TO_FRIDAY)
  return db.transaction((tx) => {
    const sortOrder = Math.max(0, ...tx.select().from(employees).all().map(e => e.sortOrder)) + 1
    const employee = tx.insert(employees).values({
      name, shortName: input.shortName.trim(), sortOrder, stampVia: input.stampVia ?? 'both', breakMode: input.breakMode ?? 'stamp',
    }).returning().get()
    tx.insert(employeeHours).values({ employeeId: employee.id, weeklyMinutes: input.weeklyMinutes, validFrom: input.validFrom, workdays }).run()
    if (input.vacationDays != null || input.carriedOverDays != null) {
      tx.insert(leaveEntitlements).values({
        employeeId: employee.id, year: parseIsoDate(input.validFrom).year,
        days: input.vacationDays ?? 0, carriedOverDays: input.carriedOverDays ?? 0,
      }).run()
    }
    if (input.openingBalanceMinutes) {
      tx.insert(balanceAdjustments).values({
        employeeId: employee.id, date: input.validFrom, minutes: input.openingBalanceMinutes, reason: OPENING_BALANCE_REASON,
      }).run()
    }
    bookClosuresFor(tx, actor, employee.id, now)
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

export function addHours(db: Db, employeeId: number, period: { weeklyMinutes: number; validFrom: IsoDate; workdays?: number }): void {
  assertEmployee(db, employeeId)
  const workdays = requireWorkdays(period.workdays ?? MONDAY_TO_FRIDAY)
  db.insert(employeeHours).values({ employeeId, weeklyMinutes: period.weeklyMinutes, validFrom: period.validFrom, workdays })
    .onConflictDoUpdate({ target: [employeeHours.employeeId, employeeHours.validFrom], set: { weeklyMinutes: period.weeklyMinutes, workdays } })
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

/** Contract data of an employee; only the Träger may change it (checked by the route). */
export function setContract(db: Db, id: number, contract: EmployeeContractDto): void {
  assertEmployee(db, id)
  const jobOther = contract.jobKey === 'other' ? contract.jobOther?.trim() || null : null
  if (contract.payLevel !== null && (contract.payLevel < 1 || contract.payLevel > 6)) throw new ServiceError(400, 'invalid_pay_level')
  const personnelNumber = contract.personnelNumber?.trim() || null
  if (personnelNumber !== null && db.select().from(employees)
    .where(and(eq(employees.personnelNumber, personnelNumber), ne(employees.id, id))).get()) {
    throw new ServiceError(409, 'personnel_number_taken')
  }
  db.update(employees).set({ ...contract, personnelNumber, jobOther }).where(eq(employees.id, id)).run()
}

/** Level steps due within the notice period or overdue, for viewers who may see contract data; staff who left are skipped. */
export function listLevelUps(db: Db, today: IsoDate, viewer: Role): LevelUpDto[] {
  if (!mayViewContract(db, viewer)) return []
  return loadEmployees(db).flatMap((employee) => {
    if (!employee.employedSince || (employee.leftOn !== null && employee.leftOn < today)) return []
    const due = dueLevelUp(employee.employedSince, employee.payLevel, today)
    return due ? [{ employeeId: employee.id, name: employee.name, fromLevel: employee.payLevel!, ...due }] : []
  })
}

/** Time tracking options of an employee, set by the Leitung: where to clock in and out, and how breaks count. */
export function setStampingOptions(db: Db, id: number, options: { stampVia: StampChannel; breakMode: BreakMode }): void {
  assertEmployee(db, id)
  db.update(employees).set(options).where(eq(employees.id, id)).run()
}
