import { and, asc, eq, inArray } from 'drizzle-orm'
import { addDays, dateRange, daysInMonth, toIsoDate } from '../../shared/domain/dates'
import { protectionPeriods } from '../../shared/domain/maternity'
import {
  checkParentalLeave, firstWorkingDayAfter, levelShiftDays, PARENTAL_LEAVE_NOTE_MAX, PARENTAL_LEAVE_PART_TIME_MAX_MINUTES,
  returnReminderState,
} from '../../shared/domain/parentalLeave'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { isWorkday } from '../../shared/domain/targets'
import { levelStart, nextLevelStep } from '../../shared/domain/tvoed'
import type { IsoDate } from '../../shared/domain/types'
import type {
  ClosureDto, EmployeeParentalLeaveDto, MonthPlanDto, ParentalLeaveCheckDto, ParentalLeaveDto, ParentalLeaveInput,
  ParentalLeaveSettingsDto, ReminderDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeChildren, employees, facilities, maternityCases, parentalLeaves } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { actorName } from './formTemplates'
import { closureOn, loadClosures, loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

// Elternzeit (BEEG) per employee: contract data. Seen with employees.contractView (routes), entered, changed and deleted
// with employees.contractEdit (routes), for the employees of the active facility. Its days have no target (a full
// Elternzeit) or the part-time hours (shared/domain/targets.ts via the EmploymentInfo of queries.ts); the plan marks a
// full Elternzeit without storing entries (parentalLeavePlanCells); the leave is cut only when the employer declared it.

type LeaveRow = typeof parentalLeaves.$inferSelect

/** An employee of the facility (404 employee_not_found). */
function assertEmployee(db: Db, facilityId: number, employeeId: number): void {
  const row = db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'employee_not_found')
}

/** A period of an employee of the facility; anything else is 404 parental_leave_not_found. */
function loadPeriod(db: Db, facilityId: number, id: number): LeaveRow {
  const row = db.select({ leave: parentalLeaves }).from(parentalLeaves)
    .innerJoin(employees, eq(employees.id, parentalLeaves.employeeId))
    .where(and(eq(parentalLeaves.id, id), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'parental_leave_not_found')
  return row.leave
}

function periodsOf(db: Db, employeeId: number): LeaveRow[] {
  return db.select().from(parentalLeaves).where(eq(parentalLeaves.employeeId, employeeId))
    .orderBy(asc(parentalLeaves.start), asc(parentalLeaves.id)).all()
}

/**
 * „Erster Arbeitstag danach“: the first day after `end` the person is expected to work (their working days then, no
 * public holiday of the home facility, no further full Elternzeit) that is no closure day of the facility (on a closure
 * the staff do not work, whether it is booked as leave or as a closure day).
 */
export function firstWorkingDayOf(employee: EmployeeRecord, closures: ClosureDto[], end: IsoDate): IsoDate | null {
  return firstWorkingDayAfter(end, date => isWorkday(employee.info, date) && closureOn(closures, date) === null)
}

function toDto(row: LeaveRow, firstWorkingDay: IsoDate | null, childName: string | null): ParentalLeaveDto {
  return {
    id: row.id, childId: row.childId, childName, childBirthDate: row.childBirthDate, start: row.start, end: row.end,
    partTimeWeeklyMinutes: row.partTimeWeeklyMinutes, reduceLeave: row.reduceLeave, note: row.note, firstWorkingDay,
    createdBy: row.createdBy,
  }
}

/** The next TVöD level step with its move by the Elternzeit (null without a level, a start, at level 6). */
export function shiftedLevelStep(employee: EmployeeRecord): { level: number; on: IsoDate; days: number } | null {
  if (!employee.employedSince) return null
  const since = levelStart(employee.employedSince, employee.trainingUntil, employee.recognitionYearCounts)
  const next = nextLevelStep(since, employee.payLevel)
  if (!next) return null
  const days = levelShiftDays(employee.info.parentalLeaves, since, next.on)
  return { level: next.level, on: addDays(next.on, days), days }
}

/**
 * The section „Elternzeit“ (404 employee_not_found): the periods with their first working day after, the children of
 * the personnel file to choose from and their names only with employees.personal, whether the viewer may edit
 * (employees.contractEdit) and the moved level step.
 */
export function getEmployeeParentalLeave(
  db: Db, viewer: { permissions: ReadonlySet<PermissionKey> }, facilityId: number, employeeId: number,
): EmployeeParentalLeaveDto {
  assertEmployee(db, facilityId, employeeId)
  const employee = loadEmployee(db, employeeId)!
  const closures = loadClosures(db, employee.facilityId)
  const personal = can(viewer.permissions, 'employees.personal')
  const children = personal
    ? db.select({ id: employeeChildren.id, firstName: employeeChildren.firstName, birthDate: employeeChildren.birthDate })
        .from(employeeChildren).where(eq(employeeChildren.employeeId, employeeId))
        .orderBy(asc(employeeChildren.birthDate), asc(employeeChildren.id)).all()
    : []
  const names = new Map(children.map(child => [child.id, child.firstName]))
  const shift = shiftedLevelStep(employee)
  return {
    periods: periodsOf(db, employeeId).map(row => toDto(
      row, firstWorkingDayOf(employee, closures, row.end), row.childId === null ? null : names.get(row.childId) ?? null,
    )),
    children,
    canEdit: can(viewer.permissions, 'employees.contractEdit'),
    levelShift: shift && shift.days > 0 ? shift : null,
  }
}

/**
 * The day after the Mutterschutz period after this birth (a case of the employee whose birth – the actual one, else the
 * expected one – is this day, not a miscarriage), else the birth date itself.
 */
function suggestedStart(db: Db, employeeId: number, childBirthDate: IsoDate): IsoDate {
  const cases = db.select().from(maternityCases).where(eq(maternityCases.employeeId, employeeId)).all()
    .filter(row => row.miscarriageOn === null && (row.actualBirth ?? row.expectedBirth) === childBirthDate)
  const after = cases.map(row => protectionPeriods(row).after?.to).filter((to): to is IsoDate => to !== undefined).sort().at(-1)
  return after ? addDays(after, 1) : childBirthDate
}

/** The person's other periods (without `exceptId`), as the checks take them. */
const othersOf = (db: Db, employeeId: number, exceptId: number | null) =>
  periodsOf(db, employeeId).filter(row => row.id !== exceptId)

/** The entries already in the plan on the days of a full Elternzeit (none with part-time work: the person works then). */
function entriesInPeriod(db: Db, employeeId: number, input: Pick<ParentalLeaveInput, 'start' | 'end' | 'partTimeWeeklyMinutes'>) {
  if (input.partTimeWeeklyMinutes !== null || input.end < input.start) return []
  return loadEntries(db, { employeeId, from: input.start, to: input.end }).map(entry => ({ date: entry.date, label: entry.label }))
}

/**
 * The child's birth date for the input: the stored one of a chosen child of the employee (404 employee_child_not_found),
 * else the one entered.
 */
function birthDateOf(db: Db, employeeId: number, input: Pick<ParentalLeaveInput, 'childId' | 'childBirthDate'>): IsoDate {
  if (input.childId === null) return input.childBirthDate
  const child = db.select({ birthDate: employeeChildren.birthDate }).from(employeeChildren)
    .where(and(eq(employeeChildren.id, input.childId), eq(employeeChildren.employeeId, employeeId))).get()
  if (!child) throw new ServiceError(404, 'employee_child_not_found')
  return child.birthDate
}

/**
 * The dialog's check before saving (stores nothing; 404 employee_not_found, employee_child_not_found): the suggested
 * start, what refuses saving, the hints, the first working day after and the entries already in a full Elternzeit.
 * `exceptId` is the period being changed.
 */
export function checkParentalLeavePeriod(
  db: Db, facilityId: number, employeeId: number, input: ParentalLeaveInput, exceptId: number | null,
): ParentalLeaveCheckDto {
  assertEmployee(db, facilityId, employeeId)
  if (exceptId !== null && loadPeriod(db, facilityId, exceptId).employeeId !== employeeId) throw new ServiceError(404, 'parental_leave_not_found')
  const childBirthDate = birthDateOf(db, employeeId, input)
  const check = checkParentalLeave({ childBirthDate, start: input.start, end: input.end }, othersOf(db, employeeId, exceptId))
  const employee = loadEmployee(db, employeeId)!
  // The person as if the period were saved: an adjoining full Elternzeit moves the first working day on.
  const withPeriod = { ...employee, info: { ...employee.info, parentalLeaves: [
    ...othersOf(db, employeeId, exceptId).map(({ start, end, partTimeWeeklyMinutes, reduceLeave }) => ({ start, end, partTimeWeeklyMinutes, reduceLeave })),
    { start: input.start, end: input.end, partTimeWeeklyMinutes: input.partTimeWeeklyMinutes, reduceLeave: input.reduceLeave },
  ] } }
  return {
    suggestedStart: suggestedStart(db, employeeId, childBirthDate), ...check,
    firstWorkingDay: input.end < input.start ? null : firstWorkingDayOf(withPeriod, loadClosures(db, employee.facilityId), input.end),
    entries: entriesInPeriod(db, employeeId, input),
  }
}

/**
 * The fields to store, checked: a chosen child of the employee (its birth date is copied; 404 employee_child_not_found),
 * part time from 1 minute to 32 hours a week (400 parental_leave_part_time_invalid), the note at most 2000 characters
 * (400 parental_leave_note_too_long), and the period (400 parental_leave_<error>: end_before_start, before_birth,
 * after_eighth_birthday, overlap with another Elternzeit of the person). More than three sections or 36 months per child
 * are hints of the dialog only.
 */
function checkedInput(db: Db, employeeId: number, input: ParentalLeaveInput, exceptId: number | null) {
  const childBirthDate = birthDateOf(db, employeeId, input)
  const minutes = input.partTimeWeeklyMinutes
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > PARENTAL_LEAVE_PART_TIME_MAX_MINUTES)) {
    throw new ServiceError(400, 'parental_leave_part_time_invalid')
  }
  const note = input.note.trim()
  if (note.length > PARENTAL_LEAVE_NOTE_MAX) throw new ServiceError(400, 'parental_leave_note_too_long')
  const { error } = checkParentalLeave({ childBirthDate, start: input.start, end: input.end }, othersOf(db, employeeId, exceptId))
  if (error) throw new ServiceError(400, `parental_leave_${error}`)
  return {
    childId: input.childId, childBirthDate, start: input.start, end: input.end, partTimeWeeklyMinutes: minutes,
    reduceLeave: input.reduceLeave, note,
  }
}

/** Saving answers the entries already in the plan on the days of a full Elternzeit (they stay; the dialog names them). */
export interface ParentalLeaveSaveDto { id: number; entries: { date: IsoDate; label: string }[] }

/** „Elternzeit eintragen“ for the facility's employee (404 employee_not_found; the checks of checkedInput). */
export function createParentalLeave(
  db: Db, actor: SessionUser, facilityId: number, employeeId: number, input: ParentalLeaveInput, now: Date = new Date(),
): ParentalLeaveSaveDto {
  assertEmployee(db, facilityId, employeeId)
  const values = checkedInput(db, employeeId, input, null)
  const at = now.toISOString()
  const id = db.insert(parentalLeaves).values({ employeeId, ...values, createdBy: actorName(db, actor), createdAt: at, updatedAt: at })
    .returning({ id: parentalLeaves.id }).get().id
  return { id, entries: entriesInPeriod(db, employeeId, values) }
}

/** Changes a period (404 parental_leave_not_found; the checks of checkedInput). */
export function updateParentalLeave(
  db: Db, facilityId: number, id: number, input: ParentalLeaveInput, now: Date = new Date(),
): ParentalLeaveSaveDto {
  const row = loadPeriod(db, facilityId, id)
  const values = checkedInput(db, row.employeeId, input, id)
  db.update(parentalLeaves).set({ ...values, updatedAt: now.toISOString() }).where(eq(parentalLeaves.id, id)).run()
  return { id, entries: entriesInPeriod(db, row.employeeId, values) }
}

/** Deletes a period entered by mistake (404 parental_leave_not_found); the target and the leave count as before again. */
export function deleteParentalLeave(db: Db, facilityId: number, id: number): void {
  loadPeriod(db, facilityId, id)
  db.delete(parentalLeaves).where(eq(parentalLeaves.id, id)).run()
}

// ---- the facility's switch ---------------------------------------------------

/** „Elternzeit für alle sichtbar anzeigen“ (404 facility_not_found); `canEdit` with employees.contractEdit. */
export function getParentalLeaveSettings(
  db: Db, viewer: { permissions: ReadonlySet<PermissionKey> }, facilityId: number,
): ParentalLeaveSettingsDto {
  const row = db.select({ visible: facilities.parentalLeaveVisible }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return { visibleToAll: row.visible, canEdit: can(viewer.permissions, 'employees.contractEdit') }
}

export function setParentalLeaveSettings(
  db: Db, viewer: { permissions: ReadonlySet<PermissionKey> }, facilityId: number, visibleToAll: boolean,
): ParentalLeaveSettingsDto {
  getParentalLeaveSettings(db, viewer, facilityId)
  db.update(facilities).set({ parentalLeaveVisible: visibleToAll }).where(eq(facilities.id, facilityId)).run()
  return getParentalLeaveSettings(db, viewer, facilityId)
}

// ---- the plan ----------------------------------------------------------------

/**
 * Whether the viewer sees „Elternzeit“ in the plan: when the facility shows it to all, otherwise with employees.view and
 * not at the tablet (Elternzeit is family data, not health data). Everybody else sees „abwesend“.
 */
export function seesParentalLeave(db: Db, viewer: Pick<SessionUser, 'role' | 'permissions'>, facilityId: number): boolean {
  const visible = db.select({ visible: facilities.parentalLeaveVisible }).from(facilities).where(eq(facilities.id, facilityId)).get()?.visible
  return visible === true || (viewer.role !== 'terminal' && can(viewer.permissions, 'employees.view'))
}

/**
 * The month's cells (cellKey `employeeId|date`) of the staff on their contract working days that a full Elternzeit makes
 * free: no entry is stored, the plan shows the label on them (see MonthPlanDto.parentalLeave).
 */
export function parentalLeavePlanCells(
  db: Db, viewer: Pick<SessionUser, 'role' | 'permissions'>, facilityId: number, staff: readonly EmployeeRecord[], year: number, month: number,
): MonthPlanDto['parentalLeave'] {
  const from = toIsoDate(year, month, 1)
  const to = toIsoDate(year, month, daysInMonth(year, month))
  const cells: string[] = []
  for (const employee of staff) {
    const periods = (employee.info.parentalLeaves ?? []).filter(period => period.partTimeWeeklyMinutes === null && period.start <= to && period.end >= from)
    if (periods.length === 0) continue
    const without = { ...employee.info, parentalLeaves: [] }
    for (const period of periods) {
      for (const date of dateRange(period.start > from ? period.start : from, period.end < to ? period.end : to)) {
        if (isWorkday(without, date)) cells.push(`${employee.id}|${date}`)
      }
    }
  }
  return { cells, label: seesParentalLeave(db, viewer, facilityId) ? 'parental_leave' : 'absent' }
}

// ---- the reminders -----------------------------------------------------------

/**
 * „‹Name› kommt am ‹Datum› aus der Elternzeit zurück“ for whoever sees the contract data (employees.contractView), not at
 * the shared tablet: from 4 weeks before the first working day after an Elternzeit through that day, for employees of
 * the facility who have not left before it.
 */
export function parentalLeaveReminders(
  db: Db, viewer: { facilityId: number; permissions: ReadonlySet<PermissionKey>; onTablet: boolean }, today: IsoDate,
): ReminderDto[] {
  if (!can(viewer.permissions, 'employees.contractView') || viewer.onTablet) return []
  const staff = loadEmployees(db, viewer.facilityId).filter(employee => (employee.info.parentalLeaves ?? []).length > 0)
  if (staff.length === 0) return []
  const closures = loadClosures(db, viewer.facilityId)
  const items: ReminderDto[] = []
  for (const employee of staff) {
    const days = new Set((employee.info.parentalLeaves ?? []).map(period => firstWorkingDayOf(employee, closures, period.end)))
    for (const date of days) {
      if (date === null || (employee.leftOn !== null && employee.leftOn < date)) continue
      const state = returnReminderState(date, today)
      if (state === null) continue
      items.push({
        kind: 'parentalLeave', date, state, name: employee.name, childId: null, age: null, ownChild: false, canDone: false,
        time: null, meetingKind: null, count: null, parentalLeave: { employeeId: employee.id },
      })
    }
  }
  return items
}

/** The employees among `employeeIds` with an Elternzeit (for tests and the retention overview). */
export function employeesWithParentalLeave(db: Db, employeeIds: readonly number[]): Set<number> {
  if (employeeIds.length === 0) return new Set()
  return new Set(db.selectDistinct({ id: parentalLeaves.employeeId }).from(parentalLeaves)
    .where(inArray(parentalLeaves.employeeId, [...employeeIds])).all().map(row => row.id))
}
