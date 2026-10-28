import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm'
import { isTimeOff, OVERTIME_OFF, timeOffMinutes } from '../../shared/domain/balance'
import { addDays, dateRange, parseIsoDate } from '../../shared/domain/dates'
import { countLeaveDays } from '../../shared/domain/leave'
import { daysOverLimit, leaveLoad, type LeaveDay } from '../../shared/domain/leaveLoad'
import { can } from '../../shared/domain/permissions'
import { dailyTarget, isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type {
  LeavePlanningDto, LeaveRequestDto, LeaveRequestKind, LeaveRequestPreviewDto, LeaveSettingsDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  absenceCodes, appSettings, employees, entries, facilities, leavePlanners, leaveRequests, users,
} from '../db/schema'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom } from './appSettings'
import { computeBalances } from './balances'
import { getYearCalendar } from './calendar'
import { entitlementFor } from './entitlements'
import { applyToCells } from './entries'
import { getLeaveAccount } from './leave'
import { accountPermissions, accountsRights } from './permissions'
import { closureOn, loadClosures, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

/** The module switch is installation-wide; the limit and the planning are per facility. */
const ENABLED = 'leave_requests_enabled'
/** Requests and leave are looked at this far around a range when counting people on leave. */
const MAX_RANGE_DAYS = 366

function setting(db: Db, key: string): string | null {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null
}

function saveSetting(db: Db, key: string, value: string | null): void {
  if (value === null) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run()
    return
  }
  db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
}

export function leaveRequestsEnabled(db: Db): boolean {
  return setting(db, ENABLED) === 'true'
}

/** How many people of the facility may be on leave at the same time (null = no limit). */
export function maxConcurrent(db: Db, facilityId: number): number | null {
  return db.select({ value: facilities.leaveMaxConcurrent }).from(facilities).where(eq(facilities.id, facilityId)).get()?.value ?? null
}

function plannerIds(db: Db): number[] {
  return db.select().from(leavePlanners).all().map(row => row.userId)
}

/**
 * Plans leave in the facility (the permission leave.plan there, fresh from the database): a Träger always, in every
 * facility; a Leitung or Mitarbeiter only in its own facility and only with the bundle „planen und genehmigen“ (see
 * accountPermissions).
 */
export function isPlanner(db: Db, user: SessionUser, facilityId: number): boolean {
  return can(accountPermissions(db, user, facilityId), 'leave.plan')
}

function requireEnabled(db: Db): void {
  if (!leaveRequestsEnabled(db)) throw new ServiceError(403, 'leave_requests_off')
}

function requirePlanner(db: Db, user: SessionUser, facilityId: number): void {
  requireEnabled(db)
  if (!isPlanner(db, user, facilityId)) throw new ServiceError(403, 'not_leave_planner')
}

// --- leave days and limits -------------------------------------------------------------------------------

/** Working days of the employee in the range that are not inside a closure (the days a request is about). */
function requestDays(employee: EmployeeRecord, from: IsoDate, to: IsoDate, closures: ReturnType<typeof loadClosures>): IsoDate[] {
  return dateRange(from, to).filter(date => isWorkday(employee.info, date) && !closureOn(closures, date))
}

/**
 * People of the staff (one facility's employees) on leave per day between from and to: "Urlaub" entries not belonging
 * to a closure and "Überstundenfrei" entries, plus open requests (of both kinds).
 */
function loadInRange(db: Db, from: IsoDate, to: IsoDate, staff: EmployeeRecord[], closures: ReturnType<typeof loadClosures>): LeaveDay[] {
  const byId = new Map(staff.map(employee => [employee.id, employee]))
  const vacation = db.select({ employeeId: entries.employeeId, date: entries.date })
    .from(entries).innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .where(and(inArray(absenceCodes.key, ['vacation', OVERTIME_OFF]), isNull(entries.closureId), gte(entries.date, from), lte(entries.date, to)))
    .all()
    .filter(day => byId.has(day.employeeId))
  const requested = db.select().from(leaveRequests)
    .where(and(eq(leaveRequests.status, 'open'), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from))).all()
    .flatMap((request) => {
      const employee = byId.get(request.employeeId)
      if (!employee) return []
      const start = request.startDate < from ? from : request.startDate
      const end = request.endDate > to ? to : request.endDate
      return requestDays(employee, start, end, closures).map(date => ({ employeeId: request.employeeId, date }))
    })
  return [...vacation, ...requested]
}

/** The days a request counts: leave days for Urlaub (24/31 December maybe half), plain working days for Überstundenfrei. */
function requestedDays(kind: LeaveRequestKind, days: IsoDate[], employee: EmployeeRecord): number {
  return kind === 'overtime_off' ? days.length : countLeaveDays(days, employee.halfLeaveOnEves)
}

/** The code a request of this kind writes into the plan when approved. */
function codeKeyOf(kind: LeaveRequestKind): 'vacation' | typeof OVERTIME_OFF {
  return kind === 'overtime_off' ? OVERTIME_OFF : 'vacation'
}

function toDto(
  db: Db, request: typeof leaveRequests.$inferSelect, staff: EmployeeRecord[], closures: ReturnType<typeof loadClosures>,
  limit: number | null, deciders: Map<number, string>,
): LeaveRequestDto {
  const employee = staff.find(candidate => candidate.id === request.employeeId)
  const days = employee ? requestDays(employee, request.startDate, request.endDate, closures) : []
  const overLimitDates = request.status === 'open' && days.length > 0
    ? daysOverLimit(leaveLoad(loadInRange(db, days[0]!, days.at(-1)!, staff, closures)), days, limit)
    : []
  return {
    id: request.id, employeeId: request.employeeId, name: employee?.name ?? '', startDate: request.startDate,
    endDate: request.endDate, note: request.note, status: request.status, kind: request.kind, createdAt: request.createdAt,
    decidedAt: request.decidedAt, decidedBy: request.decidedBy === null ? null : deciders.get(request.decidedBy) ?? null,
    decisionNote: request.decisionNote, workdays: employee ? requestedDays(request.kind, days, employee) : 0, overLimitDates,
  }
}

function userNames(db: Db): Map<number, string> {
  return new Map(db.select({ id: users.id, username: users.username }).from(users).all().map(row => [row.id, row.username]))
}

// --- settings ----------------------------------------------------------------------------------------------

/**
 * Whether anyone besides the Träger plans leave in the facility: an active Leitung or Mitarbeiter account of it with
 * leave.plan (the bundle „planen und genehmigen“).
 */
function facilityHasPlanner(db: Db, facilityId: number): boolean {
  // Only the facility's accounts (a Leitung by its own facility, a Mitarbeiter by its employee's), their rights in one read.
  const candidates = db.select({ id: users.id, role: users.role }).from(users)
    .leftJoin(employees, eq(users.employeeId, employees.id))
    .where(and(eq(users.active, true), or(
      and(eq(users.role, 'admin'), eq(users.facilityId, facilityId)),
      and(eq(users.role, 'observer'), eq(employees.facilityId, facilityId)),
    ))).all()
  const rights = accountsRights(db, candidates.map(user => ({ ...user, facilityId })))
  return [...rights.values()].some(account => account.permissions.has('leave.plan'))
}

/** The chosen Träger accounts (the list may still hold Leitung accounts from before the rights page; they count no more). */
function chosenProviders(db: Db): number[] {
  const chosen = plannerIds(db)
  if (chosen.length === 0) return []
  return db.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, chosen)).all()
    .filter(user => user.role === 'provider').map(user => user.id).sort((a, b) => a - b)
}

/**
 * The module state for the viewer, in the viewer's facility (for an employee: the employee's home facility). Who plans
 * follows from the viewer's permissions (leave.plan, the bundle „planen und genehmigen“).
 */
export function getLeaveSettings(db: Db, viewer: SessionUser): LeaveSettingsDto {
  const enabled = leaveRequestsEnabled(db)
  const facilityId = viewer.facilityId
  const permissions = viewer.permissions
  const planner = enabled && facilityId !== null && can(permissions, 'leave.plan')
  const chosen = chosenProviders(db)
  // The count (menu badge) goes to every planner of the facility; to a Träger when chosen for the notification, or while
  // nobody at all is chosen or plans there (no Träger chosen, no Leitung or Mitarbeiter of the facility planning).
  const notified = planner && (!can(permissions, 'leave.configure') || chosen.includes(viewer.id)
    || (chosen.length === 0 && !facilityHasPlanner(db, facilityId)))
  return {
    enabled,
    maxConcurrent: facilityId === null ? null : maxConcurrent(db, facilityId),
    plannerIds: can(permissions, 'leave.configure') ? chosen : [],
    isPlanner: planner,
    openCount: notified ? listOpenRequests(db, viewer, facilityId).length : 0,
  }
}

/**
 * Träger only: switch the module and choose the Träger accounts told about new requests (`plannerIds`; any other
 * account is 400 invalid_leave_planner). Who plans and decides is a right (the bundle „planen und genehmigen“).
 */
export function setLeaveModule(db: Db, input: { enabled: boolean; plannerIds: number[] }): void {
  const ids = [...new Set(input.plannerIds)]
  const valid = ids.length === 0 ? [] : db.select().from(users)
    .where(and(inArray(users.id, ids), eq(users.active, true), eq(users.role, 'provider'))).all()
  if (valid.length !== ids.length) throw new ServiceError(400, 'invalid_leave_planner')
  db.transaction((tx) => {
    saveSetting(tx, ENABLED, String(input.enabled))
    tx.delete(leavePlanners).run()
    if (ids.length) tx.insert(leavePlanners).values(ids.map(userId => ({ userId }))).run()
  })
}

/** Planners: how many people of the facility may be on leave at the same time (null = no limit). */
export function setMaxConcurrent(db: Db, user: SessionUser, facilityId: number, value: number | null): void {
  requirePlanner(db, user, facilityId)
  if (value !== null && (!Number.isInteger(value) || value < 1)) throw new ServiceError(400, 'invalid_max_concurrent')
  db.update(facilities).set({ leaveMaxConcurrent: value }).where(eq(facilities.id, facilityId)).run()
}

// --- requesting ----------------------------------------------------------------------------------------------

function requireEmployee(user: SessionUser): number {
  if (user.employeeId === null) throw new ServiceError(403, 'no_employee')
  return user.employeeId
}

/** The employee's home facility with its staff and closures: requests are handled there. */
function homeOf(db: Db, employeeId: number) {
  const facilityId = db.select({ facilityId: employees.facilityId }).from(employees).where(eq(employees.id, employeeId)).get()?.facilityId
  if (facilityId === undefined) throw new ServiceError(403, 'no_employee')
  const staff = loadEmployees(db, facilityId)
  return { facilityId, staff, employee: staff.find(candidate => candidate.id === employeeId)!, closures: loadClosures(db, facilityId) }
}

function validateRange(db: Db, employeeId: number, from: IsoDate, to: IsoDate, today: IsoDate) {
  if (to < from || dateRange(from, to).length > MAX_RANGE_DAYS) throw new ServiceError(400, 'invalid_range')
  if (from < today) throw new ServiceError(400, 'leave_in_past')
  const home = homeOf(db, employeeId)
  const days = requestDays(home.employee, from, to, home.closures)
  if (days.length === 0) throw new ServiceError(400, 'no_leave_days')
  return { ...home, days }
}

/** The days of the person's other open requests of this kind. */
function otherOpenDays(db: Db, employee: EmployeeRecord, kind: LeaveRequestKind, closures: ReturnType<typeof loadClosures>): IsoDate[] {
  return db.select().from(leaveRequests)
    .where(and(eq(leaveRequests.employeeId, employee.id), eq(leaveRequests.status, 'open'), eq(leaveRequests.kind, kind))).all()
    .flatMap(request => requestDays(employee, request.startDate, request.endDate, closures))
}

/**
 * Überstundenfrei: the balance as of today ("Stand heute", as the balance overview shows it) minus what is already
 * planned as Überstundenfrei after it, the person's other open Überstundenfrei requests and this request. A requested
 * day costs its daily target (nothing while the code is set to credit the daily target, and nothing on a day that
 * already holds another full-day absence, which the approval keeps); a planned day costs what it really takes (its time
 * range only, when it has one).
 */
function overtimeOffPreview(
  db: Db, facilityId: number, employee: EmployeeRecord, days: IsoDate[], closures: ReturnType<typeof loadClosures>, today: IsoDate,
): { minutesTaken: number; balanceAfter: number } {
  // "Stand heute" ends yesterday while the time tracking runs (today is not finished yet), see computeBalances.
  const until = activeTrackingFrom(db, facilityId, today) !== null ? addDays(today, -1) : today
  const later = loadEntries(db, { employeeId: employee.id, from: addDays(until, 1) })
  const kept = new Set(later.filter(entry => entry.codeKey !== null && entry.codeKey !== OVERTIME_OFF
    && entry.creditMode === 'daily_target').map(entry => entry.date))
  const code = db.select().from(absenceCodes).where(eq(absenceCodes.key, OVERTIME_OFF)).get()
  const dayCost = (date: IsoDate) => (code?.creditMode === 'daily_target' || kept.has(date) ? 0 : dailyTarget(employee.info, date))
  const planned = new Map<IsoDate, typeof later>()
  for (const entry of later) {
    if (entry.codeKey === OVERTIME_OFF && !kept.has(entry.date)) planned.set(entry.date, [...(planned.get(entry.date) ?? []), entry])
  }
  const cost = new Map<IsoDate, number>()
  for (const [date, list] of planned) {
    const wholeDay = list.some(entry => entry.start === null && entry.creditMode !== 'daily_target')
    cost.set(date, wholeDay ? dailyTarget(employee.info, date) : timeOffMinutes(list.filter(isTimeOff)))
  }
  for (const date of [...otherOpenDays(db, employee, 'overtime_off', closures), ...days]) {
    if (!cost.has(date)) cost.set(date, dayCost(date))
  }
  const [balance] = computeBalances(db, facilityId, [employee], until, today)
  const taken = [...cost.values()].reduce((sum, minutes) => sum + minutes, 0)
  return { minutesTaken: days.reduce((sum, date) => sum + dayCost(date), 0), balanceAfter: balance!.today - taken }
}

export function previewLeaveRequest(
  db: Db, user: SessionUser, from: IsoDate, to: IsoDate, today: IsoDate, kind: LeaveRequestKind = 'vacation',
): LeaveRequestPreviewDto {
  requireEnabled(db)
  const employeeId = requireEmployee(user)
  const { facilityId, staff, employee, closures, days } = validateRange(db, employeeId, from, to, today)
  const load = leaveLoad([
    ...loadInRange(db, days[0]!, days.at(-1)!, staff, closures),
    ...days.map(date => ({ employeeId, date })),
  ])
  const overLimitDates = daysOverLimit(load, days, maxConcurrent(db, facilityId))
  if (kind === 'overtime_off') {
    const balance = overtimeOffPreview(db, facilityId, employee, days, closures, today)
    return { workdays: days.length, availableAfter: null, overLimitDates, ...balance }
  }
  // Remaining leave of the start year: what the leave account has left (planned leave already counted), minus this
  // request and the person's other open leave requests, each without days that are already "Urlaub".
  const year = parseIsoDate(from).year
  const hasEntitlement = entitlementFor(db, employeeId, year) !== null
  const alreadyLeave = new Set(loadEntries(db, { employeeId, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date))
  const otherOpen = otherOpenDays(db, employee, 'vacation', closures)
  const newDays = new Set([...days, ...otherOpen].filter(date => date.startsWith(`${year}-`) && !alreadyLeave.has(date)))
  return {
    workdays: countLeaveDays(days, employee.halfLeaveOnEves),
    availableAfter: hasEntitlement
      ? getLeaveAccount(db, employeeId, year, today).account.available - countLeaveDays([...newDays], employee.halfLeaveOnEves)
      : null,
    overLimitDates,
  }
}

export function createLeaveRequest(
  db: Db, user: SessionUser, input: { from: IsoDate; to: IsoDate; note: string; kind?: LeaveRequestKind }, today: IsoDate,
  now: Date = new Date(),
): number {
  requireEnabled(db)
  const employeeId = requireEmployee(user)
  validateRange(db, employeeId, input.from, input.to, today)
  const overlapping = db.select().from(leaveRequests).where(and(
    eq(leaveRequests.employeeId, employeeId), inArray(leaveRequests.status, ['open', 'approved']),
    lte(leaveRequests.startDate, input.to), gte(leaveRequests.endDate, input.from),
  )).get()
  if (overlapping) throw new ServiceError(409, 'leave_request_overlaps')
  return db.insert(leaveRequests).values({
    employeeId, startDate: input.from, endDate: input.to, note: input.note.trim(), kind: input.kind ?? 'vacation',
    createdAt: now.toISOString(), createdBy: user.id,
  }).returning().get().id
}

/** The signed-in employee's requests, newest first. */
export function listMyLeaveRequests(db: Db, user: SessionUser): LeaveRequestDto[] {
  requireEnabled(db)
  const employeeId = requireEmployee(user)
  const { facilityId, staff, closures } = homeOf(db, employeeId)
  const limit = maxConcurrent(db, facilityId)
  const names = userNames(db)
  return db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId))
    .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.id)).all()
    .map(request => toDto(db, request, staff, closures, limit, names))
}

export function withdrawLeaveRequest(db: Db, user: SessionUser, id: number, now: Date = new Date()): void {
  requireEnabled(db)
  const employeeId = requireEmployee(user)
  const request = db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).get()
  if (!request || request.employeeId !== employeeId) throw new ServiceError(404, 'leave_request_not_found')
  if (request.status !== 'open') throw new ServiceError(409, 'leave_request_decided')
  db.update(leaveRequests).set({ status: 'withdrawn', decidedAt: now.toISOString(), decidedBy: user.id })
    .where(eq(leaveRequests.id, id)).run()
}

// --- deciding ------------------------------------------------------------------------------------------------

/** Open requests of the facility's employees a planner may decide (not their own), oldest first. */
export function listOpenRequests(db: Db, user: SessionUser, facilityId: number): LeaveRequestDto[] {
  const staff = loadEmployees(db, facilityId)
  if (staff.length === 0) return []
  const closures = loadClosures(db, facilityId)
  const limit = maxConcurrent(db, facilityId)
  const names = userNames(db)
  return db.select().from(leaveRequests)
    .where(and(
      eq(leaveRequests.status, 'open'),
      inArray(leaveRequests.employeeId, staff.map(employee => employee.id)),
      user.employeeId === null ? undefined : ne(leaveRequests.employeeId, user.employeeId),
    ))
    .orderBy(asc(leaveRequests.startDate), asc(leaveRequests.id)).all()
    .map(request => toDto(db, request, staff, closures, limit, names))
}

/**
 * Approves (writes "Urlaub", for an Überstundenfrei request "Überstundenfrei", on the request's days) or rejects an open request of one of the facility's employees.
 * Approving over planned duties needs `overwrite`; otherwise the server answers cells_occupied so the UI can ask first.
 */
export function decideLeaveRequest(
  db: Db, user: SessionUser, facilityId: number, id: number, decision: { approve: boolean; note: string; overwrite: boolean },
  now: Date = new Date(),
): { keptAbsences: number } {
  requirePlanner(db, user, facilityId)
  const request = db.select({ request: leaveRequests }).from(leaveRequests)
    .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .where(and(eq(leaveRequests.id, id), eq(employees.facilityId, facilityId))).get()?.request
  if (!request) throw new ServiceError(404, 'leave_request_not_found')
  if (request.status !== 'open') throw new ServiceError(409, 'leave_request_decided')
  if (request.employeeId === user.employeeId) throw new ServiceError(403, 'own_leave_request')
  const decided = { decidedAt: now.toISOString(), decidedBy: user.id, decisionNote: decision.note.trim() }
  if (!decision.approve) {
    db.update(leaveRequests).set({ status: 'rejected', ...decided }).where(eq(leaveRequests.id, id)).run()
    return { keptAbsences: 0 }
  }
  const employee = loadEmployees(db, facilityId).find(candidate => candidate.id === request.employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const requested = requestDays(employee, request.startDate, request.endDate, loadClosures(db, facilityId))
  const dayEntries = loadEntries(db, { employeeId: employee.id, from: request.startDate, to: request.endDate })
    .filter(entry => requested.includes(entry.date))
  // Days with another full-day absence (Krank, Fortbildung, Sonderurlaub …) stay as they are: e.g. a sick day must
  // never become leave (and planned leave never Überstundenfrei). Only planned duties (shifts, VZ, Büro …) may be
  // replaced, after asking.
  const codeKey = codeKeyOf(request.kind)
  const absent = new Set(dayEntries.filter(entry => entry.codeKey !== null && entry.codeKey !== codeKey
    && entry.creditMode === 'daily_target').map(entry => entry.date))
  const days = requested.filter(date => !absent.has(date))
  const occupiedDays = new Set(dayEntries.filter(entry => !absent.has(entry.date) && entry.codeKey !== codeKey)
    .map(entry => entry.date)).size
  if (occupiedDays > 0 && !decision.overwrite) {
    throw new ServiceError(409, 'cells_occupied', { days: occupiedDays })
  }
  const code = db.select().from(absenceCodes).where(eq(absenceCodes.key, codeKey)).get()
  if (!code) throw new ServiceError(500, 'code_not_found')
  db.transaction((tx) => {
    if (days.length) {
      const cells = days.map(date => ({ employeeId: employee.id, date }))
      applyToCells(tx, user, facilityId, cells, 'replace', { kind: 'code', codeId: code.id }, { now })
    }
    tx.update(leaveRequests).set({ status: 'approved', ...decided }).where(eq(leaveRequests.id, id)).run()
  })
  return { keptAbsences: absent.size }
}

// --- planning page -------------------------------------------------------------------------------------------

/**
 * The facility's year calendar with leave and open requests, its people on leave per day, and the open requests to
 * decide.
 */
export function getLeavePlanning(db: Db, user: SessionUser, facilityId: number, year: number): LeavePlanningDto {
  requirePlanner(db, user, facilityId)
  const calendar = getYearCalendar(db, facilityId, year)
  const staff = loadEmployees(db, facilityId)
  const closures = loadClosures(db, facilityId)
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const days = loadInRange(db, from, to, staff, closures)
  // Requested days without another absence show as "beantragt".
  const open = db.select().from(leaveRequests)
    .where(and(eq(leaveRequests.status, 'open'), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from))).all()
  for (const request of open) {
    const employee = staff.find(candidate => candidate.id === request.employeeId)
    const row = calendar.days[request.employeeId]
    if (!employee || !row) continue
    for (const date of requestDays(employee, request.startDate, request.endDate, closures)) row[date] ??= 'requested'
  }
  return {
    calendar: { ...calendar, events: [] },
    counts: Object.fromEntries(leaveLoad(days)),
    maxConcurrent: maxConcurrent(db, facilityId),
    openRequests: listOpenRequests(db, user, facilityId).filter(request => request.endDate >= from && request.startDate <= to),
  }
}
