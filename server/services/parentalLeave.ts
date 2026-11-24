import { and, asc, eq, inArray } from 'drizzle-orm'
import { addDays, dateRange, daysBetween, daysInMonth, toIsoDate } from '../../shared/domain/dates'
import { maskPrivateEntry, protectionPeriods } from '../../shared/domain/maternity'
import {
  checkParentalLeave, childLeaveSummary, daysToMonths, firstWorkingDayAfter, levelShiftDays, levelShiftHints, PARENTAL_LEAVE_NOTE_MAX,
  PARENTAL_LEAVE_MAX_MONTHS, PARENTAL_LEAVE_PART_TIME_MAX_MINUTES, parentalLeaveOn, returnReminderState, type LevelShiftHint,
  type ParentalLeavePeriod, type ProtectionSpan,
} from '../../shared/domain/parentalLeave'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { isWorkday, MONDAY_TO_FRIDAY, workdaysOn, type EmploymentInfo } from '../../shared/domain/targets'
import { levelStart, nextLevelStep } from '../../shared/domain/tvoed'
import type { IsoDate } from '../../shared/domain/types'
import type {
  ClosureDto, EmployeeParentalLeaveDto, MonthPlanDto, ParentalLeaveCheckDto, ParentalLeaveChildSummaryDto, ParentalLeaveDto, ParentalLeaveInput,
  ParentalLeaveSaveDto, ParentalLeaveSettingsDto, ReminderDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeChildren, employees, facilities, maternityCases, parentalLeaveBirths, parentalLeaves } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { seesProtectedCodes } from '../lib/protectedCodes'
import { actorName } from './formTemplates'
import { closureOn, loadClosures, loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

// Elternzeit (BEEG) per employee: contract data. Seen with employees.contractView (routes), entered, changed and deleted
// with employees.contractEdit (routes), for the employees of the active facility. Its days have no target (a full
// Elternzeit) or the part-time hours on the part-time working days (shared/domain/targets.ts via the EmploymentInfo of
// queries.ts); the plan marks a full Elternzeit without storing entries (parentalLeavePlanCells); the leave is cut only
// when the employer declared it.

type LeaveRow = typeof parentalLeaves.$inferSelect
/** Who asks: health codes and the Mutterschutz cases only with employees.sickness (never at the tablet). */
type Viewer = Pick<SessionUser, 'role' | 'permissions'>

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

/** The fields of a row the targets read (shared/domain/targets.ts). */
const periodOf = (row: Pick<LeaveRow, 'start' | 'end' | 'partTimeWeeklyMinutes' | 'partTimeWorkdays' | 'reduceLeave'>): ParentalLeavePeriod => ({
  start: row.start, end: row.end, partTimeWeeklyMinutes: row.partTimeWeeklyMinutes, partTimeWorkdays: row.partTimeWorkdays,
  reduceLeave: row.reduceLeave,
})

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
    partTimeWeeklyMinutes: row.partTimeWeeklyMinutes, partTimeWorkdays: row.partTimeWorkdays, reduceLeave: row.reduceLeave,
    note: row.note, firstWorkingDay, createdBy: row.createdBy,
  }
}

/**
 * The next TVöD level step with its move by the Elternzeit and the hints on it (levelShiftHints: more than five years
 * in a row, less than a month in a calendar year; never computed in). Null without a level, a start, at level 6.
 */
export function shiftedLevelStep(employee: EmployeeRecord): { level: number; on: IsoDate; days: number; hints: LevelShiftHint[] } | null {
  if (!employee.employedSince) return null
  const since = levelStart(employee.employedSince, employee.trainingUntil, employee.recognitionYearCounts)
  const next = nextLevelStep(since, employee.payLevel)
  if (!next) return null
  const days = levelShiftDays(employee.info.parentalLeaves, since, next.on)
  const on = addDays(next.on, days)
  return { level: next.level, on, days, hints: days > 0 ? levelShiftHints(employee.info.parentalLeaves, since, on) : [] }
}

/** The contract's working days on the date, without any Elternzeit (Monday to Friday when not employed). */
const contractWorkdaysOn = (info: EmploymentInfo, date: IsoDate) => workdaysOn({ ...info, parentalLeaves: [] }, date)

/**
 * The section „Elternzeit“ (404 employee_not_found): the periods with their first working day after, the children of
 * the personnel file to choose from and their names only with employees.personal, whether the viewer may edit
 * (employees.contractEdit), the contract's working days today, the moved level step and the summary per child
 * (childSummaries: the Mutterschutz after the birth with dates and months only for viewers of the health data).
 */
export function getEmployeeParentalLeave(
  db: Db, viewer: Viewer, facilityId: number, employeeId: number, today: IsoDate,
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
  const rows = periodsOf(db, employeeId)
  return {
    summaries: childSummaries(db, viewer, employeeId, rows, names),
    canEnterProtection: seesProtectedCodes(viewer),
    periods: rows.map(row => toDto(
      row, firstWorkingDayOf(employee, closures, row.end), row.childId === null ? null : names.get(row.childId) ?? null,
    )),
    children,
    canEdit: can(viewer.permissions, 'employees.contractEdit'),
    contractWorkdays: employee.info.hours.length ? contractWorkdaysOn(employee.info, today) : MONDAY_TO_FRIDAY,
    levelShift: shift && shift.days > 0 ? shift : null,
  }
}

/** The Mutterschutz after a birth with where it comes from: the case in the app, or the end entered by hand. */
type BirthProtection = ProtectionSpan & { source: 'case' | 'manual' }

/**
 * The Mutterschutz period after this birth, read regardless of the viewer (callers decide what to tell): a case of the
 * employee whose birth – the actual one, else the expected one – is this day, not a miscarriage; else the end entered by
 * hand for this birth (parental_leave_births); null without either.
 */
function birthProtection(db: Db, employeeId: number, childBirthDate: IsoDate): BirthProtection | null {
  const ends = db.select().from(maternityCases).where(eq(maternityCases.employeeId, employeeId)).all()
    .filter(row => row.miscarriageOn === null && (row.actualBirth ?? row.expectedBirth) === childBirthDate)
    .map(row => protectionPeriods(row).after?.to).filter((to): to is IsoDate => to !== undefined).sort()
  if (ends.length) return { from: childBirthDate, to: ends.at(-1)!, source: 'case' }
  const manual = db.select({ until: parentalLeaveBirths.protectionUntil }).from(parentalLeaveBirths)
    .where(and(eq(parentalLeaveBirths.employeeId, employeeId), eq(parentalLeaveBirths.childBirthDate, childBirthDate))).get()
  return manual ? { from: childBirthDate, to: manual.until, source: 'manual' } : null
}

/**
 * The Mutterschutz period after this birth for the viewer: health data (its length tells 8 or 12 weeks), so only for a
 * viewer with employees.sickness (null otherwise or without one; birthProtection).
 */
function protectionAfterBirth(db: Db, viewer: Viewer, employeeId: number, childBirthDate: IsoDate): BirthProtection | null {
  return seesProtectedCodes(viewer) ? birthProtection(db, employeeId, childBirthDate) : null
}

/**
 * The per-child summary of the section (§ 15 Abs. 2 BEEG, childLeaveSummary): the children of the periods (by the child
 * of the personnel file, else by the birth date), oldest first. A viewer with employees.sickness gets the Mutterschutz
 * after the birth with its dates and months and the exact months still possible; everybody else only whether a
 * Mutterschutz counts, the months entered and at most what is still possible (36 minus the Elternzeit; the Mutterschutz is
 * deducted on top) – nothing from which its length could be worked out.
 */
function childSummaries(
  db: Db, viewer: Viewer, employeeId: number, rows: readonly LeaveRow[], names: ReadonlyMap<number, string | null>,
): ParentalLeaveChildSummaryDto[] {
  const groups = new Map<string, LeaveRow[]>()
  for (const row of rows) {
    const key = row.childId !== null ? `child:${row.childId}` : `birth:${row.childBirthDate}`
    groups.set(key, [...groups.get(key) ?? [], row])
  }
  const sees = seesProtectedCodes(viewer)
  return [...groups.values()]
    .map((group) => {
      const { childId, childBirthDate } = group[0]!
      const protection = birthProtection(db, employeeId, childBirthDate)
      const shown = sees ? protection : null
      const exact = childLeaveSummary(childBirthDate, group, protection)
      const bound = childLeaveSummary(childBirthDate, group, null)
      return {
        childId, childName: childId === null ? null : names.get(childId) ?? null, childBirthDate,
        protection: shown ? { from: shown.from, to: shown.to, source: shown.source } : null,
        protectionCounted: protection !== null,
        totalMonths: PARENTAL_LEAVE_MAX_MONTHS,
        protectionMonths: shown ? daysToMonths(exact.protectionDays) : null,
        plannedMonths: daysToMonths(exact.plannedDays),
        remainingMonths: daysToMonths(sees || protection === null ? exact.remainingDays : bound.remainingDays),
        remainingExact: sees || protection === null,
      }
    })
    .sort((a, b) => (a.childBirthDate < b.childBirthDate ? -1 : a.childBirthDate > b.childBirthDate ? 1 : 0))
}

/** The longest Mutterschutz after a birth entered by hand: 20 weeks (12 weeks plus days of an early birth carried over). */
const PROTECTION_MAX_DAYS = 140

/**
 * „Mutterschutz nach der Geburt bis“ for a birth without a case in the app: entered and changed only with
 * employees.sickness (403 forbidden), from the birth day up to 20 weeks after it (400 parental_leave_protection_invalid);
 * null removes it. Ignored (nothing stored) while a case for the birth exists: the case wins. `undefined` = unchanged.
 */
function storeBirthProtection(
  db: Db, viewer: Viewer, employeeId: number, childBirthDate: IsoDate, until: IsoDate | null | undefined, now: Date,
): void {
  if (until === undefined) return
  if (!seesProtectedCodes(viewer)) throw new ServiceError(403, 'forbidden')
  if (until !== null && (until < childBirthDate || daysBetween(childBirthDate, until) > PROTECTION_MAX_DAYS)) {
    throw new ServiceError(400, 'parental_leave_protection_invalid')
  }
  const where = and(eq(parentalLeaveBirths.employeeId, employeeId), eq(parentalLeaveBirths.childBirthDate, childBirthDate))
  if (until === null) {
    db.delete(parentalLeaveBirths).where(where).run()
    return
  }
  if (birthProtection(db, employeeId, childBirthDate)?.source === 'case') return
  const at = now.toISOString()
  db.insert(parentalLeaveBirths).values({ employeeId, childBirthDate, protectionUntil: until, updatedAt: at })
    .onConflictDoUpdate({ target: [parentalLeaveBirths.employeeId, parentalLeaveBirths.childBirthDate], set: { protectionUntil: until, updatedAt: at } })
    .run()
}

/** The person's other periods (without `exceptId`), as the checks take them. */
const othersOf = (db: Db, employeeId: number, exceptId: number | null) =>
  periodsOf(db, employeeId).filter(row => row.id !== exceptId)

/**
 * The entries already in the plan on the days of a full Elternzeit (none with part-time work: the person works then);
 * Krank, Kind krank, Mutterschutz and Beschäftigungsverbot as „abwesend“ for a viewer without employees.sickness.
 */
function entriesInPeriod(
  db: Db, viewer: Viewer, employeeId: number, input: Pick<ParentalLeaveInput, 'start' | 'end' | 'partTimeWeeklyMinutes'>,
) {
  if (input.partTimeWeeklyMinutes !== null || input.end < input.start) return []
  const shown = seesProtectedCodes(viewer)
  return loadEntries(db, { employeeId, from: input.start, to: input.end })
    .map(entry => (shown ? entry : maskPrivateEntry(entry)))
    .map(entry => ({ date: entry.date, label: entry.label }))
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

/** The working days the part time keeps: the ones given, else the contract's at the start (null without part time). */
function partTimeWorkdaysOf(employee: EmployeeRecord, input: ParentalLeaveInput): number | null {
  if (input.partTimeWeeklyMinutes === null) return null
  return input.partTimeWorkdays ?? contractWorkdaysOn(employee.info, input.start)
}

/**
 * The dialog's check before saving (stores nothing; 404 employee_not_found, employee_child_not_found): the suggested
 * start (after the Mutterschutz only for viewers of the health data), what refuses saving, the hints (the Mutterschutz
 * after the birth counted towards the 36 months, again only for those viewers), the first working day after and the
 * entries already in a full Elternzeit. `exceptId` is the period being changed.
 */
export function checkParentalLeavePeriod(
  db: Db, viewer: Viewer, facilityId: number, employeeId: number, input: ParentalLeaveInput, exceptId: number | null,
): ParentalLeaveCheckDto {
  assertEmployee(db, facilityId, employeeId)
  if (exceptId !== null && loadPeriod(db, facilityId, exceptId).employeeId !== employeeId) throw new ServiceError(404, 'parental_leave_not_found')
  const childBirthDate = birthDateOf(db, employeeId, input)
  // The Mutterschutz after the birth (only for viewers of the health data): a hand-entered end being typed counts as if
  // saved, unless a case for the birth exists.
  const stored = protectionAfterBirth(db, viewer, employeeId, childBirthDate)
  const typed = input.protectionAfterBirthUntil
  const protection: BirthProtection | null = !seesProtectedCodes(viewer) || typed === undefined || stored?.source === 'case'
    ? stored
    : typed === null || typed < childBirthDate ? null : { from: childBirthDate, to: typed, source: 'manual' }
  const others = othersOf(db, employeeId, exceptId)
  const check = checkParentalLeave({ childId: input.childId, childBirthDate, start: input.start, end: input.end }, others, protection)
  const employee = loadEmployee(db, employeeId)!
  // The person as if the period were saved: an adjoining full Elternzeit moves the first working day on.
  const draft = { ...input, partTimeWorkdays: partTimeWorkdaysOf(employee, input) }
  const withPeriod = { ...employee, info: { ...employee.info, parentalLeaves: [...others.map(periodOf), periodOf(draft)] } }
  return {
    suggestedStart: protection ? addDays(protection.to, 1) : childBirthDate, ...check,
    // Exact only with the Mutterschutz known to the viewer; else at most (the Mutterschutz comes off on top).
    remainingExact: protection !== null || birthProtection(db, employeeId, childBirthDate) === null,
    protection: protection ? { from: protection.from, to: protection.to, source: protection.source } : null,
    firstWorkingDay: input.end < input.start ? null : firstWorkingDayOf(withPeriod, loadClosures(db, employee.facilityId), input.end),
    entries: entriesInPeriod(db, viewer, employeeId, input),
  }
}

/**
 * The fields to store, checked: a chosen child of the employee (its birth date is copied; 404 employee_child_not_found),
 * part time from 1 minute to 32 hours a week (400 parental_leave_part_time_invalid) on at least one working day (bitmask
 * 1–127, default the contract's working days at the start; 400 parental_leave_workdays_invalid), the note at most 2000
 * characters (400 parental_leave_note_too_long), and the period (400 parental_leave_<error>: end_before_start,
 * before_birth, after_eighth_birthday, overlap with another Elternzeit of the person). Sections, months per child and
 * after the 3rd birthday are hints of the dialog only.
 */
function checkedInput(db: Db, employeeId: number, input: ParentalLeaveInput, exceptId: number | null) {
  const childBirthDate = birthDateOf(db, employeeId, input)
  const minutes = input.partTimeWeeklyMinutes
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > PARENTAL_LEAVE_PART_TIME_MAX_MINUTES)) {
    throw new ServiceError(400, 'parental_leave_part_time_invalid')
  }
  const workdays = partTimeWorkdaysOf(loadEmployee(db, employeeId)!, input)
  if (workdays !== null && (!Number.isInteger(workdays) || workdays < 1 || workdays > 127)) {
    throw new ServiceError(400, 'parental_leave_workdays_invalid')
  }
  const note = input.note.trim()
  if (note.length > PARENTAL_LEAVE_NOTE_MAX) throw new ServiceError(400, 'parental_leave_note_too_long')
  const { error } = checkParentalLeave(
    { childId: input.childId, childBirthDate, start: input.start, end: input.end }, othersOf(db, employeeId, exceptId),
  )
  if (error) throw new ServiceError(400, `parental_leave_${error}`)
  return {
    childId: input.childId, childBirthDate, start: input.start, end: input.end, partTimeWeeklyMinutes: minutes,
    partTimeWorkdays: workdays, reduceLeave: input.reduceLeave, note,
  }
}

/** „Elternzeit eintragen“ for the facility's employee (404 employee_not_found; the checks of checkedInput). */
export function createParentalLeave(
  db: Db, actor: SessionUser, facilityId: number, employeeId: number, input: ParentalLeaveInput, now: Date = new Date(),
): ParentalLeaveSaveDto {
  assertEmployee(db, facilityId, employeeId)
  const values = checkedInput(db, employeeId, input, null)
  const at = now.toISOString()
  const id = db.transaction((tx) => {
    storeBirthProtection(tx, actor, employeeId, values.childBirthDate, input.protectionAfterBirthUntil, now)
    return tx.insert(parentalLeaves).values({ employeeId, ...values, createdBy: actorName(tx, actor), createdAt: at, updatedAt: at })
      .returning({ id: parentalLeaves.id }).get().id
  })
  return { id, entries: entriesInPeriod(db, actor, employeeId, values) }
}

/** Changes a period (404 parental_leave_not_found; the checks of checkedInput). */
export function updateParentalLeave(
  db: Db, actor: Viewer, facilityId: number, id: number, input: ParentalLeaveInput, now: Date = new Date(),
): ParentalLeaveSaveDto {
  const row = loadPeriod(db, facilityId, id)
  const values = checkedInput(db, row.employeeId, input, id)
  db.transaction((tx) => {
    storeBirthProtection(tx, actor, row.employeeId, values.childBirthDate, input.protectionAfterBirthUntil, now)
    tx.update(parentalLeaves).set({ ...values, updatedAt: now.toISOString() }).where(eq(parentalLeaves.id, id)).run()
  })
  return { id, entries: entriesInPeriod(db, actor, row.employeeId, values) }
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
export function seesParentalLeave(db: Db, viewer: Viewer, facilityId: number): boolean {
  const visible = db.select({ visible: facilities.parentalLeaveVisible }).from(facilities).where(eq(facilities.id, facilityId)).get()?.visible
  return visible === true || (viewer.role !== 'terminal' && can(viewer.permissions, 'employees.view'))
}

/**
 * The person's contract working days from `from` to `to` that a full Elternzeit makes free (the days the plan, the day
 * overview, „Mein Dienstplan“, the year calendar and the leave planning mark; nothing is stored).
 */
export function fullParentalLeaveDates(info: EmploymentInfo, from: IsoDate, to: IsoDate): IsoDate[] {
  const periods = (info.parentalLeaves ?? []).filter(period => period.partTimeWeeklyMinutes === null && period.start <= to && period.end >= from)
  if (periods.length === 0) return []
  const without = { ...info, parentalLeaves: [] }
  return periods.flatMap(period => dateRange(period.start > from ? period.start : from, period.end < to ? period.end : to))
    .filter(date => isWorkday(without, date))
}

/** The label of the marked days for the viewer (seesParentalLeave). */
export const parentalLeaveLabel = (db: Db, viewer: Viewer, facilityId: number): 'parental_leave' | 'absent' =>
  seesParentalLeave(db, viewer, facilityId) ? 'parental_leave' : 'absent'

/**
 * The month's cells (cellKey `employeeId|date`) of the staff on their contract working days that a full Elternzeit makes
 * free: no entry is stored, the plan (and its day overview) shows the label on them (see MonthPlanDto.parentalLeave).
 */
export function parentalLeavePlanCells(
  db: Db, viewer: Viewer, facilityId: number, staff: readonly EmployeeRecord[], year: number, month: number,
): MonthPlanDto['parentalLeave'] {
  const from = toIsoDate(year, month, 1)
  const to = toIsoDate(year, month, daysInMonth(year, month))
  const cells = staff.flatMap(employee => fullParentalLeaveDates(employee.info, from, to).map(date => `${employee.id}|${date}`))
  return { cells, label: parentalLeaveLabel(db, viewer, facilityId) }
}

// ---- the reminders -----------------------------------------------------------

/**
 * „‹Name› kommt am ‹Datum› aus der Elternzeit zurück“ for whoever sees the contract data (employees.contractView), not at
 * the shared tablet: from 4 weeks before the first working day after an Elternzeit through that day, for employees of
 * the facility who have not left before it. When that day lies in a part-time Elternzeit that follows directly
 * (`toPartTime`), the box says „wechselt am ‹Datum› in Teilzeit-Elternzeit“ instead.
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
      const toPartTime = parentalLeaveOn(employee.info.parentalLeaves, date)?.partTimeWeeklyMinutes != null
      items.push({
        kind: 'parentalLeave', date, state, name: employee.name, childId: null, age: null, ownChild: false, canDone: false,
        time: null, meetingKind: null, count: null, parentalLeave: { employeeId: employee.id, toPartTime },
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
