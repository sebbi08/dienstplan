import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm'
import { isFullDayTimed, isWorkEntry } from '../../shared/domain/balance'
import { cellKey } from '../../shared/domain/cells'
import { addDays, dateRange, daysInMonth, toIsoDate } from '../../shared/domain/dates'
import {
  absentThroughout, checkLongAbsence, countsAsSick, joinSpans, longAbsenceReturnState, longSickDates, overlapsRange, spanCovers, spansOfDates,
  type AbsenceSpan, type LongAbsenceReason,
} from '../../shared/domain/longAbsence'
import { firstWorkingDayAfter } from '../../shared/domain/parentalLeave'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { isEmployedOn, isWorkday, type EmploymentInfo } from '../../shared/domain/targets'
import type { CodeKey, IsoDate } from '../../shared/domain/types'
import type { LongAbsenceDay } from '../../shared/domain/warnings'
import type {
  ClosureDto, EmployeeLongAbsenceDto, EntryDto, LongAbsenceConflictsDto, LongAbsenceDto, LongAbsenceInput, LongAbsencePlanDto,
  LongAbsenceSaveDto, ReminderDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, entries, leaveRequests, longAbsences, timeRecords } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { seesProtectedCodes } from '../lib/protectedCodes'
import { deleteEntry } from './entries'
import { actorName } from './formTemplates'
import { bookedMaternityDates } from './maternity'
import { seesParentalLeave } from './parentalLeave'
import { closureOn, loadClosures, loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

// „Längere Abwesenheit“ (shared/domain/longAbsence.ts). The reason is health data: entered, changed and seen with
// employees.sickness (Leitung and Träger by default), for the employees of the active facility, never about oneself
// (a Leitung's own is the Träger's), never at the tablet. The routes pass the scope
// `{ facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }`. Removing duties still planned in a period needs
// plan.edit on top. Mutterschutz/Beschäftigungsverbot and Elternzeit are not stored here: their periods are read from the
// Mutterschutz booked in the plan and from a full Elternzeit (absenceSpansOf), so each has one source.

export interface LongAbsenceScope { facilityId: number; ownEmployeeId: number | null }

type Row = typeof longAbsences.$inferSelect
type Viewer = Pick<SessionUser, 'role' | 'permissions'>

const isOwn = (scope: LongAbsenceScope, employeeId: number) => scope.ownEmployeeId !== null && scope.ownEmployeeId === employeeId

/** An employee of the facility (404 employee_not_found), not the viewer themselves (403 long_absence_own). */
function assertEmployeeInScope(db: Db, scope: LongAbsenceScope, employeeId: number): void {
  const row = db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, scope.facilityId))).get()
  if (!row) throw new ServiceError(404, 'employee_not_found')
  if (isOwn(scope, employeeId)) throw new ServiceError(403, 'long_absence_own')
}

/** A long absence of an employee of the facility, not about the viewer; anything else is 404 long_absence_not_found. */
function loadRow(db: Db, scope: LongAbsenceScope, id: number): Row {
  const row = db.select({ absence: longAbsences }).from(longAbsences)
    .innerJoin(employees, eq(employees.id, longAbsences.employeeId))
    .where(and(eq(longAbsences.id, id), eq(employees.facilityId, scope.facilityId))).get()
  if (!row || isOwn(scope, row.absence.employeeId)) throw new ServiceError(404, 'long_absence_not_found')
  return row.absence
}

function rowsOf(db: Db, employeeId: number): Row[] {
  return db.select().from(longAbsences).where(eq(longAbsences.employeeId, employeeId))
    .orderBy(desc(longAbsences.start), asc(longAbsences.id)).all()
}

// ---- the periods of a person ------------------------------------------------------

/** A period of a person with where it comes from (an entered one, or taken over from the Mutterschutz or the Elternzeit). */
export interface PersonSpan extends AbsenceSpan {
  source: LongAbsenceDto['source']
}

/** The person's contract working days, without any absence (Elternzeit, long absence): the days the plan checks. */
export function contractWorkday(info: EmploymentInfo, date: IsoDate): boolean {
  return isWorkday({ ...info, parentalLeaves: [], longAbsences: [] }, date)
}

/**
 * Every long absence of the staff, by employee: the entered ones, the Mutterschutz/Beschäftigungsverbot booked in the
 * plan (the days its case wrote there, runs of calendar days) and each full Elternzeit (adjoining ones joined). A
 * Mutterschutz case not booked yet gives none: the roster shows what the Leitung entered in the plan.
 */
export function absenceSpansOf(db: Db, staff: readonly EmployeeRecord[]): Map<number, PersonSpan[]> {
  const maternity = bookedMaternityDates(db, staff.map(employee => employee.id))
  return new Map(staff.map((employee) => {
    const stored: PersonSpan[] = (employee.info.longAbsences ?? [])
      .map(period => ({ from: period.start, to: period.end, reason: period.reason, source: 'entry' }))
    const parental: PersonSpan[] = joinSpans((employee.info.parentalLeaves ?? [])
      .filter(period => period.partTimeWeeklyMinutes === null)
      .map(period => ({ from: period.start, to: period.end, reason: 'parental_leave' as LongAbsenceReason })))
      .map(span => ({ ...span, source: 'parentalLeave' }))
    const booked: PersonSpan[] = spansOfDates(maternity.get(employee.id) ?? [], 'maternity' as LongAbsenceReason)
      .map(span => ({ ...span, source: 'maternity' }))
    return [employee.id, [...stored, ...booked, ...parental]]
  }))
}

/**
 * The first day after `end` the person works again: a working day (no public holiday of the home facility), no closure
 * of the facility and in none of the person's long absences (null when none within two years).
 */
export function returnDayOf(employee: EmployeeRecord, closures: ClosureDto[], spans: readonly PersonSpan[], end: IsoDate): IsoDate | null {
  return firstWorkingDayAfter(end, date => isWorkday(employee.info, date) && closureOn(closures, date) === null
    && !spans.some(span => spanCovers(span, date)))
}

/**
 * The person's sick days from `from` to `to` for the Krankheitstage and the BEM: the days of the „Krank“ entries
 * (`manualDates`) joined with the days of Langzeitkrank and Kur/Reha – each working day of the period (no public
 * holiday), closure days included, exactly the days a whole-day „Krank“ entry stands on (a closure never books over
 * „Krank“, closures.ts, nor over these days). Computed, never stored; a day in both counts once. The one helper of both
 * paths: the callers then count working days as for „Krank“ (groupLeaveRanges, countBemSickDays).
 */
export function sickDatesWithLongAbsences(employee: EmployeeRecord, manualDates: readonly IsoDate[], from: IsoDate, to: IsoDate): IsoDate[] {
  const computed = to < from ? [] : longSickDates(employee.info.longAbsences, from, to, date => isWorkday(employee.info, date))
  return [...new Set([...manualDates, ...computed])].sort()
}

// ---- the employee page ---------------------------------------------------------------

function toDto(row: Row, returnDay: IsoDate | null, conflicts: LongAbsenceConflictsDto): LongAbsenceDto {
  return {
    id: row.id, source: 'entry', reason: row.reason, start: row.start, end: row.end, returnDay, createdBy: row.createdBy,
    createdOn: row.createdAt.slice(0, 10), conflicts,
  }
}

/**
 * The section „Längere Abwesenheit“ (403 long_absence_own, 404 employee_not_found): the entered periods with the first
 * working day after a known end, the Mutterschutz booked in the plan, and – for viewers of the contract data – each full
 * Elternzeit (both changed where they are entered); newest first.
 */
export function getEmployeeLongAbsences(
  db: Db, viewer: { permissions: ReadonlySet<PermissionKey> }, scope: LongAbsenceScope, employeeId: number,
): EmployeeLongAbsenceDto {
  assertEmployeeInScope(db, scope, employeeId)
  const employee = loadEmployee(db, employeeId)!
  const closures = loadClosures(db, employee.facilityId)
  const spans = absenceSpansOf(db, [employee]).get(employeeId) ?? []
  const returnOf = (end: IsoDate | null) => (end === null ? null : returnDayOf(employee, closures, spans, end))
  const taken: LongAbsenceDto[] = spans
    .filter(span => span.source === 'maternity' || (span.source === 'parentalLeave' && can(viewer.permissions, 'employees.contractView')))
    .map(span => ({
      id: null, source: span.source, reason: span.reason, start: span.from, end: span.to, returnDay: returnOf(span.to),
      createdBy: null, createdOn: null, conflicts: null,
    }))
  const rows = rowsOf(db, employeeId)
  const conflictsOf = rows.length === 0 ? null : conflictsLoader(db, employeeId, rows.map(row => row.start).sort()[0]!)
  const items = [...rows.map(row => toDto(row, returnOf(row.end), conflictsOf!(row.start, row.end))), ...taken]
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))
  return { items, canRemoveDuties: can(viewer.permissions, 'plan.edit') }
}

/** The fields to store, checked: the end not before the start, no day shared with another one of the person (400 long_absence_<error>). */
function checkedInput(db: Db, employeeId: number, input: LongAbsenceInput, exceptId: number | null) {
  const others = rowsOf(db, employeeId).filter(row => row.id !== exceptId)
  const error = checkLongAbsence(input, others)
  if (error) throw new ServiceError(400, `long_absence_${error}`)
  return { reason: input.reason, start: input.start, end: input.end }
}

/** Leave entries: Urlaub, Sonderurlaub, Überstundenfrei (on days of Langzeitkrank/Kur no leave is used, isLeaveWorkday). */
const LEAVE_KEYS: readonly CodeKey[] = ['vacation', 'special_leave', 'overtime_off']
const isLeaveEntry = (entry: Pick<EntryDto, 'codeKey'>) => entry.codeKey !== null && LEAVE_KEYS.includes(entry.codeKey)
/** Work planned in the cell: a duty with times or a whole Büro/VZ day. */
const isDuty = (entry: Pick<EntryDto, 'kind' | 'creditMode' | 'start' | 'end'>) => entry.kind !== 'break' && (isWorkEntry(entry) || isFullDayTimed(entry))

/** The days of the person in the period that hold time records (stamped time; never deleted with a duty). */
function stampedDaysIn(db: Db, employeeId: number, start: IsoDate, end: IsoDate | null): Set<IsoDate> {
  return new Set(db.select({ date: timeRecords.date }).from(timeRecords)
    .where(and(eq(timeRecords.employeeId, employeeId), gte(timeRecords.date, start), end === null ? undefined : lte(timeRecords.date, end)))
    .all().map(row => row.date))
}

/**
 * The entries of the person in the period that are work in this facility's plan (shifts, special shifts, VZ, Büro,
 * Arzt, whole Büro/VZ days; not help-outs elsewhere, not absences, no closure bookings), with the breaks of their days
 * and the person's leave entries there. They stay until the Leitung removes the duties (removeLongAbsenceDuties):
 * nothing is deleted without asking.
 */
function entriesIn(db: Db, employeeId: number, start: IsoDate, end: IsoDate | null): { duties: EntryDto[]; breaks: EntryDto[]; leave: EntryDto[] } {
  const homeIds = new Set(db.select({ id: entries.id }).from(entries)
    .where(and(eq(entries.employeeId, employeeId), isNull(entries.helpFacilityId))).all().map(row => row.id))
  const inPlan = loadEntries(db, { employeeId, from: start, ...(end === null ? {} : { to: end }) }).filter(entry => homeIds.has(entry.id))
  const duties = inPlan.filter(isDuty)
  const days = new Set(duties.map(entry => entry.date))
  return {
    duties, breaks: inPlan.filter(entry => entry.kind === 'break' && days.has(entry.date)), leave: inPlan.filter(isLeaveEntry),
  }
}

/**
 * What the plan still holds in the period (LongAbsenceConflictsDto): the duties (stamped ones marked), the leave entries
 * (Urlaub, Sonderurlaub, Überstundenfrei; also a closure's Urlaub), the open leave requests overlapping it and the days
 * with time records. No private code is among them (only the code's name, never a Sonderurlaub reason).
 */
function conflictsIn(db: Db, employeeId: number, start: IsoDate, end: IsoDate | null): LongAbsenceConflictsDto {
  return conflictsLoader(db, employeeId, start)(start, end)
}

/**
 * conflictsIn for several periods of the person: the entries, time records and open requests from `since` on are read
 * once, each period takes its part.
 */
function conflictsLoader(db: Db, employeeId: number, since: IsoDate): (start: IsoDate, end: IsoDate | null) => LongAbsenceConflictsDto {
  const all = entriesIn(db, employeeId, since, null)
  const stampedAll = [...stampedDaysIn(db, employeeId, since, null)]
  const requests = db.select({ from: leaveRequests.startDate, to: leaveRequests.endDate, kind: leaveRequests.kind }).from(leaveRequests)
    .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, 'open'), gte(leaveRequests.endDate, since)))
    .orderBy(asc(leaveRequests.startDate)).all()
  return (start, end) => {
    const within = (date: IsoDate) => date >= start && (end === null || date <= end)
    const stamped = new Set(stampedAll.filter(within))
    return {
      duties: all.duties.filter(entry => within(entry.date))
        .map(entry => ({ id: entry.id, date: entry.date, label: entry.label, stamped: stamped.has(entry.date) })),
      leave: all.leave.filter(entry => within(entry.date)).map(entry => ({ date: entry.date, label: entry.label })),
      openRequests: requests.filter(request => request.to >= start && (end === null || request.from <= end)), stampedDays: stamped.size,
    }
  }
}

/** „Längere Abwesenheit eintragen“ for the facility's employee (403 long_absence_own, 404 employee_not_found; checkedInput). */
export function createLongAbsence(
  db: Db, actor: SessionUser, scope: LongAbsenceScope, employeeId: number, input: LongAbsenceInput, now: Date = new Date(),
): LongAbsenceSaveDto {
  assertEmployeeInScope(db, scope, employeeId)
  const values = checkedInput(db, employeeId, input, null)
  const at = now.toISOString()
  const id = db.insert(longAbsences).values({ employeeId, ...values, createdBy: actorName(db, actor), createdAt: at, updatedAt: at })
    .returning({ id: longAbsences.id }).get().id
  return { id, ...conflictsIn(db, employeeId, values.start, values.end) }
}

/** Changes a period, e.g. ends it or makes it shorter (404 long_absence_not_found; checkedInput); the person is back from the next day. */
export function updateLongAbsence(
  db: Db, scope: LongAbsenceScope, id: number, input: LongAbsenceInput, now: Date = new Date(),
): LongAbsenceSaveDto {
  const row = loadRow(db, scope, id)
  const values = checkedInput(db, row.employeeId, input, id)
  db.update(longAbsences).set({ ...values, updatedAt: now.toISOString() }).where(eq(longAbsences.id, id)).run()
  return { id, ...conflictsIn(db, row.employeeId, values.start, values.end) }
}

/**
 * Deletes a period entered by mistake (404 long_absence_not_found): the person is in the plan again, the sick days it
 * counted are gone; no entry of the plan is touched (nothing was stored for its days).
 */
export function deleteLongAbsence(db: Db, scope: LongAbsenceScope, id: number): void {
  loadRow(db, scope, id)
  db.delete(longAbsences).where(eq(longAbsences.id, id)).run()
}

/**
 * „Dienste entfernen“ (on the period's row, any time): the duties still planned in the period (entriesIn) with the breaks
 * of their days leave the plan, each logged like any plan edit (shown as a change until released). Never a duty on a
 * day with time records: it was worked (or stamped by mistake) and stays for the Leitung to decide; `keptStamped` counts
 * those days. Leave entries are not touched. Needs plan.edit (403 forbidden); answers the days removed.
 */
export function removeLongAbsenceDuties(
  db: Db, actor: SessionUser, scope: LongAbsenceScope, id: number, now: Date = new Date(),
): { removed: number; keptStamped: number } {
  if (!can(actor.permissions, 'plan.edit')) throw new ServiceError(403, 'forbidden')
  const row = loadRow(db, scope, id)
  const { duties, breaks } = entriesIn(db, row.employeeId, row.start, row.end)
  const stamped = stampedDaysIn(db, row.employeeId, row.start, row.end)
  const removable = [...duties, ...breaks].filter(entry => !stamped.has(entry.date))
  db.transaction((tx) => {
    for (const entry of removable) deleteEntry(tx, actor, scope.facilityId, entry.id, now)
  })
  const dutyDays = new Set(duties.map(entry => entry.date))
  return {
    removed: new Set(duties.filter(entry => !stamped.has(entry.date)).map(entry => entry.date)).size,
    keptStamped: [...dutyDays].filter(date => stamped.has(date)).length,
  }
}

// ---- the plan --------------------------------------------------------------------------

/**
 * Per cellKey of the staff from `from` to `to`: the day lies in an entered long absence (`stored`) or only in a
 * Mutterschutz booked in the plan or a full Elternzeit (`derived`). For the plan's warnings (dayWarnings).
 */
export function longAbsenceDays(
  db: Db, staff: readonly EmployeeRecord[], from: IsoDate, to: IsoDate, known?: Map<number, PersonSpan[]>,
): Map<string, LongAbsenceDay> {
  const days = new Map<string, LongAbsenceDay>()
  for (const [employeeId, spans] of known ?? absenceSpansOf(db, staff)) {
    for (const span of spans) {
      if (!overlapsRange({ start: span.from, end: span.to }, from, to)) continue
      const start = span.from > from ? span.from : from
      const end = span.to === null || span.to > to ? to : span.to
      for (const date of dateRange(start, end)) {
        const key = cellKey(employeeId, date)
        if (span.source === 'entry') days.set(key, 'stored')
        else if (!days.has(key)) days.set(key, 'derived')
      }
    }
  }
  return days
}

/** The cells (cellKey) of entered long absences only: duties planned there do not count for coverage, staffing and attendance. */
export function storedAbsenceCells(
  db: Db, staff: readonly EmployeeRecord[], from: IsoDate, to: IsoDate, known?: Map<number, PersonSpan[]>,
): Set<string> {
  return new Set([...longAbsenceDays(db, staff, from, to, known)].filter(([, kind]) => kind === 'stored').map(([key]) => key))
}

/**
 * The reason a viewer may see: Langzeitkrank, Kur/Reha, Sonstiges and Mutterschutz only with employees.sickness (never at
 * the tablet), Elternzeit as the plan shows it (seesParentalLeave); null = „abwesend“.
 */
export function shownReasonFor(db: Db, viewer: Viewer, facilityId: number): (reason: LongAbsenceReason) => LongAbsenceReason | null {
  const health = seesProtectedCodes(viewer)
  const parental = seesParentalLeave(db, viewer, facilityId)
  return reason => (reason === 'parental_leave' ? (parental ? reason : null) : (health ? reason : null))
}

/**
 * The long absences of a month's plan (see LongAbsencePlanDto). The staff away on every one of their working days of the
 * month leave the plan, unless `shownEntries` hold work for them, or – for viewers of the health data – leave on a day
 * of Langzeitkrank/Kur (it uses no leave there, the Leitung should see it): nothing is hidden silently. The line below the plan names everybody with
 * a period reaching into the month. The working days in a period are marked where no entry stands, and – for viewers of
 * the health data – on a day of Langzeitkrank/Kur also beside leave entries (the absence wins over the Urlaub); not the days of a full Elternzeit (the
 * plan marks them already). `dutyCells`: duties in an entered period (they do not count). `known`: the spans when the
 * caller has them already.
 */
export function longAbsencePlan(
  db: Db, viewer: Viewer, facilityId: number, staff: readonly EmployeeRecord[], shownEntries: readonly EntryDto[], year: number, month: number,
  known?: Map<number, PersonSpan[]>,
): LongAbsencePlanDto {
  const from = toIsoDate(year, month, 1)
  const to = toIsoDate(year, month, daysInMonth(year, month))
  const shownReason = shownReasonFor(db, viewer, facilityId)
  const spans = known ?? absenceSpansOf(db, staff)
  const byCell = new Map<string, EntryDto[]>()
  for (const entry of shownEntries) {
    const key = cellKey(entry.employeeId, entry.date)
    byCell.set(key, [...byCell.get(key) ?? [], entry])
  }
  // Leave on a day of Langzeitkrank/Kur (it uses none there) keeps the person in the plan and gets the mark beside it only
  // for viewers of the health data: only those periods have that rule, so for everybody else it would tell sickness
  // apart from Sonstiges. They see the Urlaub as before and the same outcome for every kind (only duties keep a person).
  const health = seesProtectedCodes(viewer)
  const result: LongAbsencePlanDto = { people: [], hidden: [], cells: {}, dutyCells: [] }
  for (const employee of staff) {
    const own = (spans.get(employee.id) ?? []).filter(span => overlapsRange({ start: span.from, end: span.to }, from, to))
    if (own.length === 0) continue
    const sickOn = (date: IsoDate) => own.some(span => span.source === 'entry' && countsAsSick(span.reason) && spanCovers(span, date))
    const storedOn = (date: IsoDate) => own.some(span => span.source === 'entry' && spanCovers(span, date))
    const mine = shownEntries.filter(entry => entry.employeeId === employee.id)
    const keeps = mine.some(entry => isDuty(entry) || (health && isLeaveEntry(entry) && sickOn(entry.date)))
    const days = dateRange(from, to).filter(date => isEmployedOn(employee.info, date) && contractWorkday(employee.info, date))
    if (absentThroughout(own, days, { from, to }, keeps)) result.hidden.push(employee.id)
    for (const span of joinSpans(own.map(item => ({ from: item.from, to: item.to, reason: shownReason(item.reason) })))) {
      result.people.push({
        employeeId: employee.id, name: employee.name, from: span.from, to: span.to, reason: span.reason, groupId: employee.groupId,
      })
    }
    result.dutyCells.push(...mine.filter(entry => isDuty(entry) && storedOn(entry.date)).map(entry => cellKey(employee.id, entry.date)))
    for (const date of days) {
      const key = cellKey(employee.id, date)
      const span = own.find(item => item.reason !== 'parental_leave' && spanCovers(item, date))
      if (!span) continue
      const cell = byCell.get(key) ?? []
      const onlyLeave = health && cell.length > 0 && cell.every(isLeaveEntry) && sickOn(date)
      if (cell.length === 0 || onlyLeave) result.cells[key] = shownReason(span.reason)
    }
  }
  result.dutyCells = [...new Set(result.dutyCells)]
  return result
}

/**
 * „Mein Dienstplan“: the person's own working days from `from` to `to` in an entered long absence or a Mutterschutz booked
 * in the plan (a full Elternzeit has its own mark), shown as „Längere Abwesenheit“ where no entry stands.
 */
export function ownLongAbsenceDates(db: Db, employee: EmployeeRecord, from: IsoDate, to: IsoDate): Set<IsoDate> {
  const spans = (absenceSpansOf(db, [employee]).get(employee.id) ?? []).filter(span => span.source !== 'parentalLeave')
  if (spans.length === 0) return new Set()
  return new Set(dateRange(from, to).filter(date => isEmployedOn(employee.info, date) && contractWorkday(employee.info, date)
    && spans.some(span => spanCovers(span, date))))
}

// ---- the reminders -----------------------------------------------------------------------

/**
 * „‹Name› kommt am ‹Datum› zurück (längere Abwesenheit)“ for whoever has employees.sickness in the office (not at the
 * tablet), never about themselves: from 2 weeks before the first working day after an entered long absence with a known
 * end through that day, for employees of the facility who have not left before it. No reason is named. (A return from
 * Elternzeit has its own reminder, 4 weeks ahead.)
 */
export function longAbsenceReminders(
  db: Db, viewer: { facilityId: number; permissions: ReadonlySet<PermissionKey>; onTablet: boolean; employeeId: number | null },
  today: IsoDate,
): ReminderDto[] {
  if (!can(viewer.permissions, 'employees.sickness') || viewer.onTablet) return []
  const staff = loadEmployees(db, viewer.facilityId)
    .filter(employee => employee.id !== viewer.employeeId && (employee.info.longAbsences ?? []).some(period => period.end !== null))
  if (staff.length === 0) return []
  const closures = loadClosures(db, viewer.facilityId)
  const spans = absenceSpansOf(db, staff)
  const items: ReminderDto[] = []
  for (const employee of staff) {
    const own = spans.get(employee.id) ?? []
    // Long past ends need no search (the return day lies at most a few free days after the end).
    const ends = (employee.info.longAbsences ?? []).flatMap(period => (period.end === null || period.end < addDays(today, -60) ? [] : [period.end]))
    const days = new Set(ends.map(end => returnDayOf(employee, closures, own, end)))
    for (const date of days) {
      if (date === null || (employee.leftOn !== null && employee.leftOn < date)) continue
      const state = longAbsenceReturnState(date, today)
      if (state === null) continue
      items.push({
        kind: 'longAbsence', date, state, name: employee.name, childId: null, age: null, ownChild: false, canDone: false,
        time: null, meetingKind: null, count: null, longAbsence: { employeeId: employee.id },
      })
    }
  }
  return items
}
