import { and, asc, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm'
import { dateRange, parseIsoDate } from '../../shared/domain/dates'
import { daysOverLimit, leaveLoad, type LeaveDay } from '../../shared/domain/leaveLoad'
import { isManager } from '../../shared/domain/roles'
import { isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type {
  LeavePlanningDto, LeaveRequestDto, LeaveRequestPreviewDto, LeaveSettingsDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  absenceCodes, appSettings, employees, entries, facilities, leavePlanners, leaveRequests, users,
} from '../db/schema'
import { ServiceError } from '../lib/errors'
import { getYearCalendar } from './calendar'
import { entitlementFor } from './entitlements'
import { applyToCells } from './entries'
import { getLeaveAccount } from './leave'
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
 * A Träger may always plan, in every facility; a Leitung only in its own facility and only when the Träger made it
 * responsible.
 */
export function isPlanner(db: Db, user: SessionUser, facilityId: number): boolean {
  if (user.role === 'provider') return true
  return user.role === 'admin' && user.facilityId === facilityId && plannerIds(db).includes(user.id)
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
 * to a closure, plus open requests.
 */
function loadInRange(db: Db, from: IsoDate, to: IsoDate, staff: EmployeeRecord[], closures: ReturnType<typeof loadClosures>): LeaveDay[] {
  const byId = new Map(staff.map(employee => [employee.id, employee]))
  const vacation = db.select({ employeeId: entries.employeeId, date: entries.date })
    .from(entries).innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .where(and(eq(absenceCodes.key, 'vacation'), isNull(entries.closureId), gte(entries.date, from), lte(entries.date, to)))
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
    endDate: request.endDate, note: request.note, status: request.status, createdAt: request.createdAt,
    decidedAt: request.decidedAt, decidedBy: request.decidedBy === null ? null : deciders.get(request.decidedBy) ?? null,
    decisionNote: request.decisionNote, workdays: days.length, overLimitDates,
  }
}

function userNames(db: Db): Map<number, string> {
  return new Map(db.select({ id: users.id, username: users.username }).from(users).all().map(row => [row.id, row.username]))
}

// --- settings ----------------------------------------------------------------------------------------------

/** The chosen planners who plan in the facility: Träger accounts and the facility's Leitung accounts. */
function plannersOf(db: Db, facilityId: number, chosen: number[]): number[] {
  if (chosen.length === 0) return []
  return db.select().from(users).where(inArray(users.id, chosen)).all()
    .filter(user => user.role === 'provider' || (user.role === 'admin' && user.facilityId === facilityId))
    .map(user => user.id)
}

/** The module state for the viewer, in the viewer's facility (for an employee: the employee's home facility). */
export function getLeaveSettings(db: Db, viewer: SessionUser): LeaveSettingsDto {
  const enabled = leaveRequestsEnabled(db)
  const facilityId = viewer.facilityId
  const planner = enabled && facilityId !== null && isPlanner(db, viewer, facilityId)
  const chosen = plannerIds(db)
  // The count (menu badge) goes to the chosen people; to the Träger only while nobody is chosen for the facility.
  const notified = planner && (chosen.includes(viewer.id)
    || (viewer.role === 'provider' && plannersOf(db, facilityId, chosen).length === 0))
  return {
    enabled,
    maxConcurrent: facilityId === null ? null : maxConcurrent(db, facilityId),
    plannerIds: isManager(viewer.role) ? chosen : [],
    isPlanner: planner,
    openCount: notified ? listOpenRequests(db, viewer, facilityId).length : 0,
  }
}

/**
 * Träger only: switch the module and choose the responsible Träger/Leitung accounts (of any facility; a Leitung plans
 * only in its own).
 */
export function setLeaveModule(db: Db, input: { enabled: boolean; plannerIds: number[] }): void {
  const ids = [...new Set(input.plannerIds)]
  const valid = ids.length === 0 ? [] : db.select().from(users)
    .where(and(inArray(users.id, ids), eq(users.active, true))).all().filter(user => isManager(user.role))
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

export function previewLeaveRequest(db: Db, user: SessionUser, from: IsoDate, to: IsoDate, today: IsoDate): LeaveRequestPreviewDto {
  requireEnabled(db)
  const employeeId = requireEmployee(user)
  const { facilityId, staff, employee, closures, days } = validateRange(db, employeeId, from, to, today)
  const load = leaveLoad([
    ...loadInRange(db, days[0]!, days.at(-1)!, staff, closures),
    ...days.map(date => ({ employeeId, date })),
  ])
  // Remaining leave of the start year: what the leave account has left (planned leave already counted), minus this
  // request and the person's other open requests, each without days that are already "Urlaub".
  const year = parseIsoDate(from).year
  const hasEntitlement = entitlementFor(db, employeeId, year) !== null
  const alreadyLeave = new Set(loadEntries(db, { employeeId, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date))
  const otherOpen = db.select().from(leaveRequests)
    .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, 'open'))).all()
    .flatMap(request => requestDays(employee, request.startDate, request.endDate, closures))
  const newDays = new Set([...days, ...otherOpen].filter(date => date.startsWith(`${year}-`) && !alreadyLeave.has(date)))
  return {
    workdays: days.length,
    availableAfter: hasEntitlement ? getLeaveAccount(db, employeeId, year, today).account.available - newDays.size : null,
    overLimitDates: daysOverLimit(load, days, maxConcurrent(db, facilityId)),
  }
}

export function createLeaveRequest(
  db: Db, user: SessionUser, input: { from: IsoDate; to: IsoDate; note: string }, today: IsoDate, now: Date = new Date(),
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
    employeeId, startDate: input.from, endDate: input.to, note: input.note.trim(),
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
 * Approves (writes "Urlaub" on the request's days) or rejects an open request of one of the facility's employees.
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
  // never become leave. Only planned duties (shifts, VZ, Büro …) may be replaced, after asking.
  const absent = new Set(dayEntries.filter(entry => entry.codeKey !== null && entry.codeKey !== 'vacation'
    && entry.creditMode === 'daily_target').map(entry => entry.date))
  const days = requested.filter(date => !absent.has(date))
  const occupiedDays = new Set(dayEntries.filter(entry => !absent.has(entry.date) && entry.codeKey !== 'vacation')
    .map(entry => entry.date)).size
  if (occupiedDays > 0 && !decision.overwrite) {
    throw new ServiceError(409, 'cells_occupied', { days: occupiedDays })
  }
  const vacation = db.select().from(absenceCodes).where(eq(absenceCodes.key, 'vacation')).get()
  if (!vacation) throw new ServiceError(500, 'code_not_found')
  db.transaction((tx) => {
    if (days.length) {
      const cells = days.map(date => ({ employeeId: employee.id, date }))
      applyToCells(tx, user, facilityId, cells, 'replace', { kind: 'code', codeId: vacation.id }, { now })
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
