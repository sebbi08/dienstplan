import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { addDays, dateRange, daysBetween, daysInMonth, toIsoDate } from '../../shared/domain/dates'
import {
  EMPLOYMENT_BAN_CODE, MATERNITY_CODE, MATERNITY_NOTE_MAX, isUnder18On, maternityDayWarnings, maternityLastDay,
  maternityMonthWarning, maternityOpenOn, maternityPhaseOn, protectionDates, protectionPeriods, type MaternityFacts,
} from '../../shared/domain/maternity'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { isEmployedOn, isWorkday } from '../../shared/domain/targets'
import type { CodeKey, IsoDate } from '../../shared/domain/types'
import type { Warning } from '../../shared/domain/warnings'
import type { LawEntry } from '../../shared/domain/workingTimeLaw'
import type {
  EmployeeMaternityDto, MaternityBookingDto, MaternityCaseDto, MaternityCaseInput, MaternitySaveDto, MaternityTask, ReminderDto,
  SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, employees, entries, maternityCases } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { applyToCells, deleteEntry } from './entries'
import { actorName } from './formTemplates'
import { closureOn, loadClosures, loadEmployee, loadEntries, type EmployeeRecord } from './queries'

// Mutterschutz (MuSchG). Pregnancy is health data: only for whoever has employees.sickness (Leitung and Träger by
// default), in the employee's home facility, never about themselves (a Leitung's case is the Träger's), never at the
// tablet. The routes pass the scope `{ facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }`. Booking the
// plan (Schutzfristen, Beschäftigungsverbot) needs plan.edit on top.

export interface MaternityScope { facilityId: number; ownEmployeeId: number | null }

type CaseRow = typeof maternityCases.$inferSelect

const isOwn = (scope: MaternityScope, employeeId: number) => scope.ownEmployeeId !== null && scope.ownEmployeeId === employeeId

/** An employee of the facility (404 employee_not_found), not the viewer themselves (403 maternity_own). */
function assertEmployeeInScope(db: Db, scope: MaternityScope, employeeId: number): void {
  const row = db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, scope.facilityId))).get()
  if (!row) throw new ServiceError(404, 'employee_not_found')
  if (isOwn(scope, employeeId)) throw new ServiceError(403, 'maternity_own')
}

/** A case of an employee of the facility, not about the viewer; anything else is 404 maternity_not_found (no existence leak). */
function loadCase(db: Db, scope: MaternityScope, id: number): CaseRow {
  const row = db.select({ maternity: maternityCases }).from(maternityCases)
    .innerJoin(employees, eq(employees.id, maternityCases.employeeId))
    .where(and(eq(maternityCases.id, id), eq(employees.facilityId, scope.facilityId))).get()
  if (!row || isOwn(scope, row.maternity.employeeId)) throw new ServiceError(404, 'maternity_not_found')
  return row.maternity
}

function toDto(row: CaseRow): MaternityCaseDto {
  return {
    id: row.id, notifiedOn: row.notifiedOn, expectedBirth: row.expectedBirth, actualBirth: row.actualBirth,
    extendedAfter: row.extendedAfter, breastfeedingUntil: row.breastfeedingUntil, authorityNotifiedOn: row.authorityNotifiedOn,
    riskAssessmentOn: row.riskAssessmentOn, employmentBan: row.employmentBan, banFrom: row.banFrom, banTo: row.banTo,
    banNote: row.banNote, banCheckedOn: row.banCheckedOn, protectionBooked: row.protectionBooked, banBooked: row.banBooked,
    endedOn: row.endedOn, createdOn: row.createdAt.slice(0, 10), createdBy: row.createdBy,
  }
}

/** The cases of the employees, newest first (by the notice). */
function casesOf(db: Db, employeeIds: number[]): CaseRow[] {
  if (employeeIds.length === 0) return []
  return db.select().from(maternityCases).where(inArray(maternityCases.employeeId, employeeIds))
    .orderBy(desc(maternityCases.notifiedOn), desc(maternityCases.id)).all()
}

/** The section „Mutterschutz“ of the employee page (403 maternity_own, 404 employee_not_found). */
export function getEmployeeMaternity(
  db: Db, viewer: { permissions: ReadonlySet<PermissionKey> }, scope: MaternityScope, employeeId: number,
): EmployeeMaternityDto {
  assertEmployeeInScope(db, scope, employeeId)
  return { cases: casesOf(db, [employeeId]).map(toDto), canBook: can(viewer.permissions, 'plan.edit') }
}

/**
 * The fields to store, checked: the notice, the actual birth and the dates of the authority notice and the risk
 * assessment not after today (400 maternity_date_future); the actual birth at most 26 weeks before and 9 weeks after the
 * expected one (400 maternity_birth_invalid, a typo in the year); the breastfeeding time not ending before the birth
 * (400 maternity_breastfeeding_invalid); a ban (partial or full) from a day, its end not before it, no days without a ban
 * (400 maternity_ban_invalid); the end not before the notice (400 maternity_ended_invalid); the note at most 2000
 * characters (400 maternity_note_too_long).
 */
function checkedInput(input: MaternityCaseInput, today: IsoDate) {
  for (const date of [input.notifiedOn, input.actualBirth, input.authorityNotifiedOn, input.riskAssessmentOn]) {
    if (date !== null && date > today) throw new ServiceError(400, 'maternity_date_future')
  }
  if (input.actualBirth !== null) {
    const offset = daysBetween(input.expectedBirth, input.actualBirth)
    if (offset < -182 || offset > 63) throw new ServiceError(400, 'maternity_birth_invalid')
  }
  const birth = input.actualBirth ?? input.expectedBirth
  if (input.breastfeedingUntil !== null && input.breastfeedingUntil < birth) throw new ServiceError(400, 'maternity_breastfeeding_invalid')
  const ban = input.employmentBan === 'none'
    ? { banFrom: null, banTo: null }
    : { banFrom: input.banFrom, banTo: input.banTo }
  if (input.employmentBan !== 'none' && (ban.banFrom === null || (ban.banTo !== null && ban.banTo < ban.banFrom))) {
    throw new ServiceError(400, 'maternity_ban_invalid')
  }
  if (input.endedOn !== null && input.endedOn < input.notifiedOn) throw new ServiceError(400, 'maternity_ended_invalid')
  const banNote = input.banNote.trim()
  if (banNote.length > MATERNITY_NOTE_MAX) throw new ServiceError(400, 'maternity_note_too_long')
  return {
    notifiedOn: input.notifiedOn, expectedBirth: input.expectedBirth, actualBirth: input.actualBirth,
    extendedAfter: input.extendedAfter, breastfeedingUntil: input.breastfeedingUntil,
    authorityNotifiedOn: input.authorityNotifiedOn, riskAssessmentOn: input.riskAssessmentOn,
    employmentBan: input.employmentBan, ...ban, banNote, endedOn: input.endedOn,
  }
}

/** Enters a case for the facility's employee; answers its id. */
export function createMaternityCase(
  db: Db, actor: SessionUser, scope: MaternityScope, employeeId: number, input: MaternityCaseInput, today: IsoDate,
  now: Date = new Date(),
): number {
  assertEmployeeInScope(db, scope, employeeId)
  const at = now.toISOString()
  return db.insert(maternityCases).values({
    employeeId, ...checkedInput(input, today), createdBy: actorName(db, actor), createdAt: at, updatedAt: at,
  }).returning({ id: maternityCases.id }).get().id
}

// ---- booking the plan ---------------------------------------------------------

/** The days of the protection periods (both). */
function protectionSet(row: Pick<CaseRow, 'expectedBirth' | 'actualBirth' | 'extendedAfter'>): Set<IsoDate> {
  return new Set(protectionDates(row))
}

/**
 * The days of the ban to book: a full ban only (a partial one is a note on the case plus shorter duties), from its first
 * day to its end; without an end until the day before the protection period before the birth (a ban during the
 * pregnancy) or, after the birth, until the end of the breastfeeding time. Never on days of the protection periods
 * (Mutterschutz comes first). Empty when there is no such period.
 */
function banDates(row: Pick<CaseRow, 'employmentBan' | 'banFrom' | 'banTo' | 'expectedBirth' | 'actualBirth' | 'extendedAfter' | 'breastfeedingUntil'>): IsoDate[] {
  if (row.employmentBan !== 'full' || row.banFrom === null) return []
  const { before, birth } = protectionPeriods(row)
  const to = row.banTo
    ?? (row.banFrom < birth ? addDays(before?.from ?? birth, -1) : row.breastfeedingUntil)
  if (to === null || to < row.banFrom) return []
  const protectedDays = protectionSet(row)
  return dateRange(row.banFrom, to).filter(date => !protectedDays.has(date))
}

interface CodeBooking {
  /** The days to write the code on. */
  days: IsoDate[]
  keptAbsences: number
  /** Days of `days` holding entries the code would replace (duties, VZ, Büro …). */
  occupied: IsoDate[]
  occupiedByOtherEntries: boolean
}

/**
 * Booking the code on these days of the employee, as leave is booked (leaveRequests.ts planLeaveBooking): only working
 * days outside closures; days with another full-day absence (Krank, Urlaub, Fortbildung …) are kept, days holding only
 * the code for the whole day stay as they are; duties are replaced only after asking. `replaces` are codes the booking
 * replaces without asking (Mutterschutz replaces the Beschäftigungsverbot).
 */
function planCodeBooking(
  db: Db, employee: EmployeeRecord, facilityId: number, dates: readonly IsoDate[], codeKey: CodeKey, replaces: CodeKey[],
): CodeBooking {
  const closures = loadClosures(db, facilityId)
  const requested = [...new Set(dates)].sort().filter(date => isWorkday(employee.info, date) && !closureOn(closures, date))
  if (requested.length === 0) return { days: [], keptAbsences: 0, occupied: [], occupiedByOtherEntries: false }
  const wanted = new Set(requested)
  const dayEntries = loadEntries(db, { employeeId: employee.id, from: requested[0]!, to: requested.at(-1)! })
    .filter(entry => wanted.has(entry.date))
  const replaced = (key: CodeKey | null) => key !== null && replaces.includes(key)
  const absent = new Set(dayEntries.filter(entry => entry.codeKey !== null && entry.codeKey !== codeKey && !replaced(entry.codeKey)
    && entry.creditMode === 'daily_target').map(entry => entry.date))
  const notYetBooked = new Set(dayEntries.filter(entry => entry.codeKey !== codeKey || entry.start !== null).map(entry => entry.date))
  const booked = new Set(dayEntries.map(entry => entry.date).filter(date => !notYetBooked.has(date)))
  const days = requested.filter(date => !absent.has(date) && !booked.has(date))
  const occupiedEntries = dayEntries.filter(entry => !absent.has(entry.date) && entry.codeKey !== codeKey && !replaced(entry.codeKey))
  return {
    days, keptAbsences: absent.size, occupied: [...new Set(occupiedEntries.map(entry => entry.date))],
    occupiedByOtherEntries: occupiedEntries.some(entry => entry.kind === 'code'),
  }
}

/** Removes the employee's own entries of the code on these days (not a closure's, not a help-out's); answers the days. */
function removeCodeDays(db: Db, actor: SessionUser, facilityId: number, employeeId: number, dates: readonly IsoDate[], codeKey: CodeKey, now: Date): number {
  if (dates.length === 0) return 0
  const rows = db.select({ id: entries.id, date: entries.date })
    .from(entries).innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .where(and(
      eq(entries.employeeId, employeeId), eq(absenceCodes.key, codeKey), isNull(entries.helpFacilityId), isNull(entries.closureId),
      inArray(entries.date, [...dates]),
    )).all()
  for (const row of rows) deleteEntry(db, actor, facilityId, row.id, now)
  return new Set(rows.map(row => row.date)).size
}

/** Writes the code on the days (replacing what they hold; logged like any plan edit, see applyToCells). */
function writeCodeDays(db: Db, actor: SessionUser, facilityId: number, employeeId: number, days: IsoDate[], codeKey: CodeKey, now: Date): void {
  if (days.length === 0) return
  const code = db.select({ id: absenceCodes.id }).from(absenceCodes).where(eq(absenceCodes.key, codeKey)).get()
  if (!code) throw new ServiceError(500, 'code_not_found')
  applyToCells(db, actor, facilityId, days.map(date => ({ employeeId, date })), 'replace', { kind: 'code', codeId: code.id }, { now })
}

export type MaternityBookingKind = 'protection' | 'ban'

const CODE_OF: Record<MaternityBookingKind, CodeKey> = { protection: MATERNITY_CODE, ban: EMPLOYMENT_BAN_CODE }
const REPLACES: Record<MaternityBookingKind, CodeKey[]> = { protection: [EMPLOYMENT_BAN_CODE], ban: [] }
const datesOf = (row: CaseRow, kind: MaternityBookingKind): IsoDate[] => (kind === 'protection' ? protectionDates(row) : banDates(row))

function requirePlanEdit(actor: SessionUser): void {
  if (!can(actor.permissions, 'plan.edit')) throw new ServiceError(403, 'forbidden')
}

/**
 * „Schutzfristen eintragen“ (code Mutterschutz on the working days of both protection periods) or
 * „Beschäftigungsverbot eintragen“ (code Beschäftigungsverbot on the working days of a full ban, outside the protection
 * periods): days with another full-day absence are kept, duties need `overwrite` (409 cells_occupied with the number of
 * days, nothing written). Needs plan.edit (403 forbidden); 400 maternity_ban_period for a ban without a full ban period.
 * Marks the case as booked, so a later change of its dates books the plan again (updateMaternityCase).
 */
export function bookMaternity(
  db: Db, actor: SessionUser, scope: MaternityScope, id: number, kind: MaternityBookingKind, overwrite: boolean, now: Date = new Date(),
): MaternityBookingDto {
  requirePlanEdit(actor)
  const row = loadCase(db, scope, id)
  const dates = datesOf(row, kind)
  if (kind === 'ban' && dates.length === 0) throw new ServiceError(400, 'maternity_ban_period')
  const employee = loadEmployee(db, row.employeeId)!
  const booking = planCodeBooking(db, employee, scope.facilityId, dates, CODE_OF[kind], REPLACES[kind])
  if (booking.occupied.length > 0 && !overwrite) {
    throw new ServiceError(409, 'cells_occupied', { days: booking.occupied.length, entries: booking.occupiedByOtherEntries })
  }
  db.transaction((tx) => {
    writeCodeDays(tx, actor, scope.facilityId, row.employeeId, booking.days, CODE_OF[kind], now)
    tx.update(maternityCases).set(kind === 'protection' ? { protectionBooked: true } : { banBooked: true }).where(eq(maternityCases.id, id)).run()
  })
  return { booked: booking.days.length, removed: 0, keptAbsences: booking.keptAbsences, skippedOccupied: 0 }
}

/**
 * Booking again after the case's dates changed (e.g. the actual birth entered): the days of the old period no longer in
 * the new one lose their entry of the code; the days new in the period get it, as far as they are free (duties stay,
 * other absences too). Days in both stay as they are, so a day the employee chose to work before the birth stays a duty.
 */
function rebook(db: Db, actor: SessionUser, facilityId: number, employee: EmployeeRecord, kind: MaternityBookingKind, before: IsoDate[], after: IsoDate[], now: Date): MaternityBookingDto {
  const oldDays = new Set(before)
  const newDays = new Set(after)
  const removed = removeCodeDays(db, actor, facilityId, employee.id, before.filter(date => !newDays.has(date)), CODE_OF[kind], now)
  const booking = planCodeBooking(db, employee, facilityId, after.filter(date => !oldDays.has(date)), CODE_OF[kind], REPLACES[kind])
  const occupied = new Set(booking.occupied)
  const days = booking.days.filter(date => !occupied.has(date))
  writeCodeDays(db, actor, facilityId, employee.id, days, CODE_OF[kind], now)
  return { booked: days.length, removed, keptAbsences: booking.keptAbsences, skippedOccupied: occupied.size }
}

const sameDays = (a: IsoDate[], b: IsoDate[]) => a.length === b.length && a.every((date, index) => date === b[index])

/**
 * Saves the case's fields. When the protection periods (or the full ban's days) were booked and changed – the actual
 * birth entered, the 12 weeks ticked … – the plan is booked again (rebook), if the actor may edit the plan.
 */
export function updateMaternityCase(
  db: Db, actor: SessionUser, scope: MaternityScope, id: number, input: MaternityCaseInput, today: IsoDate, now: Date = new Date(),
): MaternitySaveDto {
  const row = loadCase(db, scope, id)
  const values = checkedInput(input, today)
  const next: CaseRow = { ...row, ...values }
  const mayBook = can(actor.permissions, 'plan.edit')
  const employee = loadEmployee(db, row.employeeId)!
  return db.transaction((tx) => {
    tx.update(maternityCases).set({ ...values, updatedAt: now.toISOString() }).where(eq(maternityCases.id, id)).run()
    const result: MaternitySaveDto = { id, protection: null, ban: null }
    for (const kind of ['protection', 'ban'] as const) {
      const booked = kind === 'protection' ? row.protectionBooked : row.banBooked
      const before = datesOf(row, kind)
      const after = datesOf(next, kind)
      if (!booked || !mayBook || sameDays(before, after)) continue
      result[kind] = rebook(tx, actor, scope.facilityId, employee, kind, before, after, now)
    }
    return result
  })
}

/** Deletes a case (entered by mistake); the plan's entries stay as they are. */
export function deleteMaternityCase(db: Db, scope: MaternityScope, id: number): void {
  loadCase(db, scope, id)
  db.delete(maternityCases).where(eq(maternityCases.id, id)).run()
}

/** „Beschäftigungsverbot geprüft“: ends the reminder to check a ban (the day it was done, today). */
export function checkMaternityBan(db: Db, scope: MaternityScope, id: number, today: IsoDate, now: Date = new Date()): void {
  loadCase(db, scope, id)
  db.update(maternityCases).set({ banCheckedOn: today, updatedAt: now.toISOString() }).where(eq(maternityCases.id, id)).run()
}

// ---- the reminders -----------------------------------------------------------

/**
 * The box „Erinnerungen“: for whoever has employees.sickness in the office (not at the tablet), per case of an employee
 * of the facility that applies today (from the notice to its last day, maternityOpenOn), not about the viewer: the risk
 * assessment (§ 10 MuSchG) until its day is entered, the notice to the supervisory authority (§ 27, „unverzüglich“:
 * overdue from the day after the notice) until its day is entered, and once „Beschäftigungsverbot prüfen“ until it is
 * marked checked or a ban (partial or full) is entered.
 */
export function maternityReminders(
  db: Db, viewer: { facilityId: number; permissions: ReadonlySet<PermissionKey>; onTablet: boolean; employeeId: number | null },
  today: IsoDate,
): ReminderDto[] {
  if (!can(viewer.permissions, 'employees.sickness') || viewer.onTablet) return []
  const staff = db.select({ id: employees.id, name: employees.name }).from(employees)
    .where(eq(employees.facilityId, viewer.facilityId)).all()
    .filter(employee => employee.id !== viewer.employeeId)
  const names = new Map(staff.map(employee => [employee.id, employee.name]))
  const items: ReminderDto[] = []
  for (const row of casesOf(db, [...names.keys()]).reverse()) {
    if (!maternityOpenOn(row, today)) continue
    const item = (task: MaternityTask, state: ReminderDto['state']): ReminderDto => ({
      kind: 'maternity', date: row.notifiedOn, state, name: names.get(row.employeeId)!, childId: null, age: null, ownChild: false,
      canDone: false, time: null, meetingKind: null, count: null, maternity: { employeeId: row.employeeId, caseId: row.id, task },
    })
    if (row.authorityNotifiedOn === null) items.push(item('authority', row.notifiedOn < today ? 'overdue' : 'today'))
    if (row.riskAssessmentOn === null) items.push(item('riskAssessment', 'today'))
    if (row.banCheckedOn === null && row.employmentBan === 'none') items.push(item('banCheck', 'today'))
  }
  return items
}

// ---- the plan's hints ----------------------------------------------------------

/**
 * The Mutterschutz hints of the month's plan (§§ 4–6 MuSchG, shared/domain/maternity.ts) for the staff with a case that
 * applies on some day of the month: per day the case applies and the person is employed, the day rules from the planned
 * entries (`entriesOf`, all their entries, help-outs elsewhere included, and the day before for the rest), and the
 * monthly average over these days. `full` for a viewer who may see the case (employees.sickness); everybody else gets
 * „Arbeitszeitgrenze überschritten“ (`work_limit`), one per person and day, which tells neither the rule nor the reason.
 */
export function maternityPlanWarnings(
  db: Db, staff: readonly EmployeeRecord[], entriesOf: (employeeId: number, date: IsoDate) => LawEntry[], year: number, month: number,
  full: boolean,
): Warning[] {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const byId = new Map(staff.map(employee => [employee.id, employee]))
  const cases = casesOf(db, [...byId.keys()])
    .filter(row => row.notifiedOn <= monthEnd && maternityLastDay(row) >= monthStart)
  if (cases.length === 0) return []
  const births = new Map(db.select({ id: employees.id, birthday: employees.birthday, birthYear: employees.birthYear }).from(employees)
    .where(inArray(employees.id, [...new Set(cases.map(row => row.employeeId))])).all().map(row => [row.id, row]))
  const warnings: Warning[] = []
  for (const employeeId of new Set(cases.map(row => row.employeeId))) {
    const employee = byId.get(employeeId)!
    const own: MaternityFacts[] = cases.filter(row => row.employeeId === employeeId)
    const birth = births.get(employeeId)
    const days: { date: IsoDate; facts: MaternityFacts }[] = []
    for (const date of dateRange(monthStart, monthEnd)) {
      const facts = own.find(row => maternityOpenOn(row, date))
      if (facts && isEmployedOn(employee.info, date)) days.push({ date, facts })
    }
    const found = days.flatMap(({ date, facts }) => maternityDayWarnings({
      date, employeeId, phase: maternityPhaseOn(facts, date), under18: isUnder18On(birth?.birthday ?? null, birth?.birthYear ?? null, date),
      entries: entriesOf(employeeId, date), previousEntries: entriesOf(employeeId, addDays(date, -1)), holidays: employee.info.holidays,
    }))
    const last = days.at(-1)
    const average = last === undefined
      ? null
      : maternityMonthWarning({
          employeeId, dates: days.map(day => day.date), info: employee.info, entriesOf: date => entriesOf(employeeId, date),
          phase: maternityPhaseOn(last.facts, last.date),
        })
    if (average) found.push(average)
    if (full) {
      warnings.push(...found)
      continue
    }
    for (const date of [...new Set(found.map(warning => warning.date))].sort()) warnings.push({ type: 'work_limit', date, employeeId })
  }
  return warnings
}
