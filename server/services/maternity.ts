import { and, desc, eq, inArray, isNull, like } from 'drizzle-orm'
import { addDays, dateRange, daysBetween, daysInMonth, toIsoDate } from '../../shared/domain/dates'
import {
  banDates, EMPLOYMENT_BAN_CODE, isUnder18On, MATERNITY_CODE, MATERNITY_NOTE_MAX, maternityDayWarnings, maternityDoubleWeekWarnings,
  maternityLastDay, maternityMonthWarning, maternityOpenOn, maternityPhaseOn, protectedAfterDates, protectionDates,
  type BanFacts, type MaternityFacts, type MaternityWarning, type PeriodFacts,
} from '../../shared/domain/maternity'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { addMonths } from '../../shared/domain/requirements'
import { isEmployedOn, isWorkday } from '../../shared/domain/targets'
import type { CodeKey, IsoDate } from '../../shared/domain/types'
import type { Warning } from '../../shared/domain/warnings'
import { plannedWorkMinutes } from '../../shared/domain/workingTimeLaw'
import type {
  EmployeeMaternityDto, EntryDto, MaternityBookingDto, MaternityCaseDto, MaternityCaseInput, MaternitySaveDto, MaternityTask,
  ReminderDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, employees, entries, maternityCases, warningAcks } from '../db/schema'
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

// ---- what was written to the plan --------------------------------------------

/** The fields the booked days follow (protection periods, ban, end), as stored in `plan_sync`. */
type SyncFacts = PeriodFacts & BanFacts & { breastfeedingUntil: IsoDate | null; endedOn: IsoDate | null }
interface PlanSync { protection?: SyncFacts; ban?: SyncFacts }
export type MaternityBookingKind = 'protection' | 'ban'
const KINDS: readonly MaternityBookingKind[] = ['protection', 'ban']

function syncFactsOf(row: Pick<CaseRow, keyof SyncFacts>): SyncFacts {
  return {
    expectedBirth: row.expectedBirth, actualBirth: row.actualBirth, extendedAfter: row.extendedAfter, miscarriageOn: row.miscarriageOn ?? null,
    miscarriageWeek: row.miscarriageWeek ?? null, miscarriageWaived: row.miscarriageWaived ?? false, employmentBan: row.employmentBan, banFrom: row.banFrom,
    banTo: row.banTo, breastfeedingUntil: row.breastfeedingUntil, endedOn: row.endedOn,
  }
}

const isBooked = (row: Pick<CaseRow, 'protectionBooked' | 'banBooked'>, kind: MaternityBookingKind) =>
  kind === 'protection' ? row.protectionBooked : row.banBooked

/** The facts last written to the plan per kind; a case booked before `plan_sync` existed counts as in step. */
function readSync(row: CaseRow): PlanSync {
  const sync = row.planSync ? JSON.parse(row.planSync) as PlanSync : {}
  for (const kind of KINDS) if (isBooked(row, kind) && !sync[kind]) sync[kind] = syncFactsOf(row)
  return sync
}

const sameFacts = (a: SyncFacts, b: SyncFacts) => JSON.stringify(syncFactsOf(a as CaseRow)) === JSON.stringify(syncFactsOf(b as CaseRow))

/** The days a kind books: both protection periods, or a full ban's days (never protection days); none after the end. */
const datesOf = (facts: SyncFacts, kind: MaternityBookingKind): IsoDate[] => (kind === 'protection' ? protectionDates(facts) : banDates(facts))

/** The plan no longer matches the case: a booked kind whose facts changed since it was written (e.g. saved without plan.edit). */
function planOutdated(row: CaseRow): boolean {
  const sync = readSync(row)
  const now = syncFactsOf(row)
  return KINDS.some(kind => isBooked(row, kind) && !sameFacts(sync[kind]!, now))
}

function toDto(row: CaseRow): MaternityCaseDto {
  return {
    id: row.id, notifiedOn: row.notifiedOn, expectedBirth: row.expectedBirth, actualBirth: row.actualBirth,
    extendedAfter: row.extendedAfter, breastfeedingUntil: row.breastfeedingUntil, authorityNotifiedOn: row.authorityNotifiedOn,
    riskAssessmentOn: row.riskAssessmentOn, employmentBan: row.employmentBan, banFrom: row.banFrom, banTo: row.banTo,
    banNote: row.banNote, banCheckedOn: row.banCheckedOn, protectionBooked: row.protectionBooked, banBooked: row.banBooked,
    planOutdated: planOutdated(row), endedOn: row.endedOn, miscarriageOn: row.miscarriageOn, miscarriageWeek: row.miscarriageWeek,
    miscarriageWaived: row.miscarriageWaived, createdOn: row.createdAt.slice(0, 10), createdBy: row.createdBy,
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
 * The fields to store, checked: the notice, the actual birth, the miscarriage and the dates of the authority notice and
 * the risk assessment not after today (400 maternity_date_future); the actual birth at most 26 weeks before and 9 weeks
 * after the expected one (400 maternity_birth_invalid, a typo in the year); a miscarriage with its week of pregnancy
 * (1–45) and without a birth (400 maternity_miscarriage_invalid); the breastfeeding time not ending before the birth
 * (400 maternity_breastfeeding_invalid); a ban (partial or full) from a day, its end not before it, no days without a ban
 * (400 maternity_ban_invalid); the end not before the notice (400 maternity_ended_invalid); the note at most 2000
 * characters (400 maternity_note_too_long).
 */
function checkedInput(input: MaternityCaseInput, today: IsoDate) {
  const miscarriageOn = input.miscarriageOn ?? null
  for (const date of [input.notifiedOn, input.actualBirth, input.authorityNotifiedOn, input.riskAssessmentOn, miscarriageOn]) {
    if (date !== null && date > today) throw new ServiceError(400, 'maternity_date_future')
  }
  if (input.actualBirth !== null) {
    const offset = daysBetween(input.expectedBirth, input.actualBirth)
    if (offset < -182 || offset > 63) throw new ServiceError(400, 'maternity_birth_invalid')
  }
  const week = miscarriageOn === null ? null : input.miscarriageWeek ?? null
  if (miscarriageOn !== null && (input.actualBirth !== null || week === null || !Number.isInteger(week) || week < 1 || week > 45)) {
    throw new ServiceError(400, 'maternity_miscarriage_invalid')
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
    extendedAfter: input.extendedAfter, breastfeedingUntil: miscarriageOn === null ? input.breastfeedingUntil : null,
    authorityNotifiedOn: input.authorityNotifiedOn, riskAssessmentOn: input.riskAssessmentOn,
    employmentBan: input.employmentBan, ...ban, banNote, endedOn: input.endedOn,
    miscarriageOn, miscarriageWeek: week, miscarriageWaived: miscarriageOn !== null && (input.miscarriageWaived ?? false),
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

/** Leave the booking takes back (§ 24 MuSchG: leave cannot be taken in the protection periods or during a ban). */
const LEAVE_CODES: CodeKey[] = ['vacation', 'special_leave', 'overtime_off']

interface CodeBooking {
  /** The days to write the code on. */
  days: IsoDate[]
  keptAbsences: number
  /** Days of `days` holding entries the code would replace (duties, VZ, Büro …). */
  occupied: IsoDate[]
  occupiedByOtherEntries: boolean
  /** Days of `days` holding leave (Urlaub, Sonderurlaub, Überstundenfrei): booking replaces them and gives the leave back. */
  leave: IsoDate[]
}

/**
 * Booking the code on these days of the employee, as leave is booked (leaveRequests.ts planLeaveBooking): only working
 * days outside closures; days with another full-day absence (Krank, Fortbildung …) are kept, days holding only the code
 * for the whole day stay as they are; duties and leave are replaced only after asking. `replaces` are codes the booking
 * replaces without asking (Mutterschutz replaces the Beschäftigungsverbot).
 */
function planCodeBooking(
  db: Db, employee: EmployeeRecord, facilityId: number, dates: readonly IsoDate[], codeKey: CodeKey, replaces: CodeKey[],
): CodeBooking {
  const closures = loadClosures(db, facilityId)
  const requested = [...new Set(dates)].sort().filter(date => isWorkday(employee.info, date) && !closureOn(closures, date))
  if (requested.length === 0) return { days: [], keptAbsences: 0, occupied: [], occupiedByOtherEntries: false, leave: [] }
  const wanted = new Set(requested)
  const dayEntries = loadEntries(db, { employeeId: employee.id, from: requested[0]!, to: requested.at(-1)! })
    .filter(entry => wanted.has(entry.date))
  const replaced = (key: CodeKey | null) => key !== null && replaces.includes(key)
  const isLeave = (key: CodeKey | null) => key !== null && LEAVE_CODES.includes(key)
  const absent = new Set(dayEntries.filter(entry => entry.codeKey !== null && entry.codeKey !== codeKey && !replaced(entry.codeKey)
    && !isLeave(entry.codeKey) && entry.creditMode === 'daily_target').map(entry => entry.date))
  const notYetBooked = new Set(dayEntries.filter(entry => entry.codeKey !== codeKey || entry.start !== null).map(entry => entry.date))
  const booked = new Set(dayEntries.map(entry => entry.date).filter(date => !notYetBooked.has(date)))
  const days = requested.filter(date => !absent.has(date) && !booked.has(date))
  const open = dayEntries.filter(entry => !absent.has(entry.date) && entry.codeKey !== codeKey && !replaced(entry.codeKey))
  const leave = new Set(open.filter(entry => isLeave(entry.codeKey)).map(entry => entry.date))
  const occupiedEntries = open.filter(entry => !isLeave(entry.codeKey))
  return {
    days, keptAbsences: absent.size, occupied: [...new Set(occupiedEntries.map(entry => entry.date))].filter(date => !leave.has(date)),
    occupiedByOtherEntries: occupiedEntries.some(entry => entry.kind === 'code'), leave: [...leave],
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

const CODE_OF: Record<MaternityBookingKind, CodeKey> = { protection: MATERNITY_CODE, ban: EMPLOYMENT_BAN_CODE }
const REPLACES: Record<MaternityBookingKind, CodeKey[]> = { protection: [EMPLOYMENT_BAN_CODE], ban: [] }
const NOTHING: MaternityBookingDto = { booked: 0, removed: 0, keptAbsences: 0, skippedOccupied: 0, protectedDuties: 0, returnedLeave: 0, keptLeave: 0 }

function requirePlanEdit(actor: SessionUser): void {
  if (!can(actor.permissions, 'plan.edit')) throw new ServiceError(403, 'forbidden')
}

function storeSync(db: Db, id: number, sync: PlanSync, now: Date): void {
  db.update(maternityCases).set({
    planSync: JSON.stringify(sync), protectionBooked: sync.protection !== undefined, banBooked: sync.ban !== undefined,
    updatedAt: now.toISOString(),
  }).where(eq(maternityCases.id, id)).run()
}

/**
 * „Schutzfristen eintragen“ (code Mutterschutz on the working days of both protection periods) or
 * „Beschäftigungsverbot eintragen“ (code Beschäftigungsverbot on the working days of a full ban, outside the protection
 * periods); `afterBirthOnly` only the days of the period after the birth (or the miscarriage), e.g. to replace duties
 * left there. Days with another full-day absence are kept; duties and leave (given back, § 24 MuSchG) need `overwrite`
 * (409 cells_occupied with the number of days, whether other entries, and the leave days; nothing written). Days the
 * plan still holds from earlier dates of the case (saved without plan.edit) lose the code. Needs plan.edit (403
 * forbidden); 400 maternity_ban_period for a ban without a full ban period. Marks the case as booked with its facts.
 */
export function bookMaternity(
  db: Db, actor: SessionUser, scope: MaternityScope, id: number, kind: MaternityBookingKind, overwrite: boolean,
  options: { afterBirthOnly?: boolean; now?: Date } = {},
): MaternityBookingDto {
  requirePlanEdit(actor)
  const now = options.now ?? new Date()
  const row = loadCase(db, scope, id)
  const facts = syncFactsOf(row)
  const all = datesOf(facts, kind)
  if (kind === 'ban' && all.length === 0) throw new ServiceError(400, 'maternity_ban_period')
  const dates = kind === 'protection' && options.afterBirthOnly ? protectedAfterDates(facts) : all
  const sync = readSync(row)
  const current = new Set(all)
  const stale = sync[kind] ? datesOf(sync[kind]!, kind).filter(date => !current.has(date)) : []
  const employee = loadEmployee(db, row.employeeId)!
  const booking = planCodeBooking(db, employee, scope.facilityId, dates, CODE_OF[kind], REPLACES[kind])
  if ((booking.occupied.length > 0 || booking.leave.length > 0) && !overwrite) {
    throw new ServiceError(409, 'cells_occupied', {
      days: booking.occupied.length, entries: booking.occupiedByOtherEntries, leaveDays: booking.leave.length,
    })
  }
  return db.transaction((tx) => {
    const removed = removeCodeDays(tx, actor, scope.facilityId, row.employeeId, stale, CODE_OF[kind], now)
    writeCodeDays(tx, actor, scope.facilityId, row.employeeId, booking.days, CODE_OF[kind], now)
    storeSync(tx, id, { ...sync, [kind]: facts }, now)
    return { ...NOTHING, booked: booking.days.length, removed, keptAbsences: booking.keptAbsences, returnedLeave: booking.leave.length }
  })
}

/**
 * Booking again after the case's facts changed (actual birth, 12 weeks, miscarriage, ban, end …): the days of the old
 * period no longer in the new one lose their entry of the code; the days new in the period, and every day of the period
 * after the birth (in which no work is allowed), get it as far as they are free. Duties are never replaced here: those
 * in the period after the birth (or on a ban day) are counted as `protectedDuties` (the plan shows a hint on each), those
 * on new days before the birth as `skippedOccupied`; leave on new days stays and is counted (`keptLeave`). Other days in
 * both periods stay as they are, so a day the employee chose to work before the birth stays a duty.
 */
function rebook(
  db: Db, actor: SessionUser, facilityId: number, employee: EmployeeRecord, kind: MaternityBookingKind, before: SyncFacts,
  after: SyncFacts, now: Date,
): MaternityBookingDto {
  const oldDays = datesOf(before, kind)
  const newDays = datesOf(after, kind)
  const oldSet = new Set(oldDays)
  const newSet = new Set(newDays)
  const removed = removeCodeDays(db, actor, facilityId, employee.id, oldDays.filter(date => !newSet.has(date)), CODE_OF[kind], now)
  const strict = new Set(kind === 'protection' ? protectedAfterDates(after) : newDays)
  const candidates = [...newDays.filter(date => !oldSet.has(date)), ...newDays.filter(date => strict.has(date))]
  const booking = planCodeBooking(db, employee, facilityId, candidates, CODE_OF[kind], REPLACES[kind])
  const blocked = new Set([...booking.occupied, ...booking.leave])
  const days = booking.days.filter(date => !blocked.has(date))
  writeCodeDays(db, actor, facilityId, employee.id, days, CODE_OF[kind], now)
  return {
    ...NOTHING, booked: days.length, removed, keptAbsences: booking.keptAbsences,
    protectedDuties: booking.occupied.filter(date => strict.has(date)).length,
    skippedOccupied: booking.occupied.filter(date => !strict.has(date)).length, keptLeave: booking.leave.length,
  }
}

/**
 * Saves the case's fields. When a booked kind's facts changed – the actual birth entered, the 12 weeks ticked, a
 * miscarriage, „Beendet am“ (the days after it are removed) … – the plan is booked again (rebook) if the actor may edit
 * the plan; otherwise the case is saved and `planOutdated` says the plan still has to be adjusted (a reminder for
 * whoever may book it; booking later compares with what was written).
 */
export function updateMaternityCase(
  db: Db, actor: SessionUser, scope: MaternityScope, id: number, input: MaternityCaseInput, today: IsoDate, now: Date = new Date(),
): MaternitySaveDto {
  const row = loadCase(db, scope, id)
  const values = checkedInput(input, today)
  const next: CaseRow = { ...row, ...values }
  const nextFacts = syncFactsOf(next)
  const mayBook = can(actor.permissions, 'plan.edit')
  const employee = loadEmployee(db, row.employeeId)!
  const sync = readSync(row)
  return db.transaction((tx) => {
    tx.update(maternityCases).set({ ...values, updatedAt: now.toISOString() }).where(eq(maternityCases.id, id)).run()
    const result: MaternitySaveDto = { id, protection: null, ban: null, planOutdated: false }
    for (const kind of KINDS) {
      const old = sync[kind]
      if (!old || sameFacts(old, nextFacts)) continue
      if (!mayBook) {
        result.planOutdated = true
        continue
      }
      result[kind] = rebook(tx, actor, scope.facilityId, employee, kind, old, nextFacts, now)
      sync[kind] = nextFacts
    }
    if (mayBook) storeSync(tx, id, sync, now)
    return result
  })
}

/**
 * Deletes a case (entered by mistake); with `removeEntries` (needs plan.edit, 403 forbidden) also the days it booked in
 * the plan (only its codes). Its acknowledged plan hints go with it. Answers the days removed.
 */
export function deleteMaternityCase(
  db: Db, actor: SessionUser, scope: MaternityScope, id: number, removeEntries: boolean, now: Date = new Date(),
): { removed: number } {
  const row = loadCase(db, scope, id)
  if (removeEntries) requirePlanEdit(actor)
  const sync = readSync(row)
  return db.transaction((tx) => {
    let removed = 0
    if (removeEntries) {
      for (const kind of KINDS) {
        const facts = sync[kind]
        if (facts) removed += removeCodeDays(tx, actor, scope.facilityId, row.employeeId, datesOf(facts, kind), CODE_OF[kind], now)
      }
    }
    deleteMaternityAcks(tx, row)
    tx.delete(maternityCases).where(eq(maternityCases.id, id)).run()
    return { removed }
  })
}

/** The acknowledgements of the case's plan hints (`maternity|<date>|<employeeId>|<rule>` within its days), any facility. */
function deleteMaternityAcks(db: Db, row: CaseRow): void {
  const last = maternityLastDay(row)
  const ids = db.select({ id: warningAcks.id, key: warningAcks.key, date: warningAcks.date }).from(warningAcks)
    .where(like(warningAcks.key, `maternity|%|${row.employeeId}|%`)).all()
    .filter(ack => ack.key.split('|')[2] === String(row.employeeId) && ack.date >= row.notifiedOn && ack.date <= last)
    .map(ack => ack.id)
  if (ids.length > 0) db.delete(warningAcks).where(inArray(warningAcks.id, ids)).run()
}

/** „Beschäftigungsverbot geprüft“: ends the reminder to check a ban (the day it was done, today). */
export function checkMaternityBan(db: Db, scope: MaternityScope, id: number, today: IsoDate, now: Date = new Date()): void {
  loadCase(db, scope, id)
  db.update(maternityCases).set({ banCheckedOn: today, updatedAt: now.toISOString() }).where(eq(maternityCases.id, id)).run()
}

// ---- the reminders -----------------------------------------------------------

/** The risk assessment counts as overdue this many days after the notice. */
const RISK_ASSESSMENT_DAYS = 14

/**
 * The box „Erinnerungen“: for whoever has employees.sickness in the office (not at the tablet), per case of an employee
 * of the facility who has not left, not about the viewer: the notice to the supervisory authority (§ 27, „unverzüglich“:
 * overdue from the day after the notice) and the risk assessment (§ 10, overdue 14 days after the notice), each until
 * its day is entered – also after the case ended; while the case applies once „Beschäftigungsverbot prüfen“ until it is
 * marked checked or a ban is entered; and, for whoever may also edit the plan, „Dienstplan anpassen“ while booked days no
 * longer match the case (saved without plan.edit).
 */
export function maternityReminders(
  db: Db, viewer: { facilityId: number; permissions: ReadonlySet<PermissionKey>; onTablet: boolean; employeeId: number | null },
  today: IsoDate,
): ReminderDto[] {
  if (!can(viewer.permissions, 'employees.sickness') || viewer.onTablet) return []
  const staff = db.select({ id: employees.id, name: employees.name, leftOn: employees.leftOn }).from(employees)
    .where(eq(employees.facilityId, viewer.facilityId)).all()
    .filter(employee => employee.id !== viewer.employeeId && (employee.leftOn === null || employee.leftOn >= today))
  const names = new Map(staff.map(employee => [employee.id, employee.name]))
  const mayBook = can(viewer.permissions, 'plan.edit')
  const items: ReminderDto[] = []
  for (const row of casesOf(db, [...names.keys()]).reverse()) {
    if (row.notifiedOn > today) continue
    const item = (task: MaternityTask, state: ReminderDto['state']): ReminderDto => ({
      kind: 'maternity', date: row.notifiedOn, state, name: names.get(row.employeeId)!, childId: null, age: null, ownChild: false,
      canDone: false, time: null, meetingKind: null, count: null, maternity: { employeeId: row.employeeId, caseId: row.id, task },
    })
    if (row.authorityNotifiedOn === null) items.push(item('authority', row.notifiedOn < today ? 'overdue' : 'today'))
    if (row.riskAssessmentOn === null) {
      items.push(item('riskAssessment', addDays(row.notifiedOn, RISK_ASSESSMENT_DAYS) < today ? 'overdue' : 'today'))
    }
    const open = maternityOpenOn(row, today)
    if (open && row.banCheckedOn === null && row.employmentBan === 'none' && row.miscarriageOn === null) items.push(item('banCheck', 'today'))
    if (mayBook && planOutdated(row)) items.push(item('planSync', 'today'))
  }
  return items
}

// ---- the plan's hints ----------------------------------------------------------

/**
 * The Mutterschutz hints of the month's plan (§§ 3–6 MuSchG, shared/domain/maternity.ts) for the staff with a case that
 * applies on some day of the month: per day the case applies and the person is employed, the day rules from the planned
 * entries (all their entries, help-outs elsewhere included, and the day before for the rest; any work in the period
 * after the birth or on a full ban day is its own hint), the monthly average over these days, and the double weeks
 * ending in the month. `full` for a viewer who may see the case (employees.sickness); everybody else gets „Arbeitszeitgrenze
 * überschritten“ (`work_limit`), one per person and day with the day's planned minutes, which tells neither rule nor reason.
 */
export function maternityPlanWarnings(db: Db, staff: readonly EmployeeRecord[], year: number, month: number, full: boolean): Warning[] {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  // The double weeks ending in the month reach 13 days back.
  const rangeStart = addDays(monthStart, -13)
  const byId = new Map(staff.map(employee => [employee.id, employee]))
  const cases = casesOf(db, [...byId.keys()])
    .filter(row => row.notifiedOn <= monthEnd && maternityLastDay(row) >= rangeStart)
  if (cases.length === 0) return []
  const employeeIds = [...new Set(cases.map(row => row.employeeId))]
  const births = new Map(db.select({ id: employees.id, birthday: employees.birthday, birthYear: employees.birthYear }).from(employees)
    .where(inArray(employees.id, employeeIds)).all().map(row => [row.id, row]))
  const entriesByCell = new Map<string, EntryDto[]>()
  for (const entry of loadEntries(db, { employeeIds, from: addDays(rangeStart, -1), to: monthEnd })) {
    const key = `${entry.employeeId}|${entry.date}`
    entriesByCell.set(key, [...entriesByCell.get(key) ?? [], entry])
  }
  const warnings: Warning[] = []
  for (const employeeId of employeeIds) {
    const employee = byId.get(employeeId)!
    const entriesOf = (date: IsoDate) => entriesByCell.get(`${employeeId}|${date}`) ?? []
    const own: MaternityFacts[] = cases.filter(row => row.employeeId === employeeId)
    const bans = new Map(own.map(facts => [facts, new Set(banDates(facts as CaseRow))]))
    const birth = births.get(employeeId)
    const under18On = (date: IsoDate) => isUnder18On(birth?.birthday ?? null, birth?.birthYear ?? null, date)
    const days: { date: IsoDate; facts: MaternityFacts }[] = []
    for (const date of dateRange(rangeStart, monthEnd)) {
      const facts = own.find(row => maternityOpenOn(row, date))
      if (facts && isEmployedOn(employee.info, date)) days.push({ date, facts })
    }
    const factsOn = new Map(days.map(day => [day.date, day.facts]))
    const monthDays = days.filter(day => day.date >= monthStart)
    const found: MaternityWarning[] = monthDays.flatMap(({ date, facts }) => maternityDayWarnings({
      date, employeeId, phase: maternityPhaseOn(facts, date), under18: under18On(date), entries: entriesOf(date),
      previousEntries: entriesOf(addDays(date, -1)), holidays: employee.info.holidays, banned: bans.get(facts)!.has(date),
      miscarriage: facts.miscarriageOn !== null,
    }))
    const last = monthDays.at(-1)
    const average = last === undefined
      ? null
      : maternityMonthWarning({
          employeeId, dates: monthDays.map(day => day.date), info: employee.info, entriesOf, phase: maternityPhaseOn(last.facts, last.date),
        })
    if (average) found.push(average)
    found.push(...maternityDoubleWeekWarnings({
      employeeId, caseDays: days.map(day => day.date), from: monthStart, to: monthEnd, entriesOf, under18On,
      phaseOf: date => maternityPhaseOn(factsOn.get(date)!, date),
    }))
    if (full) {
      warnings.push(...found)
      continue
    }
    for (const date of [...new Set(found.map(warning => warning.date))].sort()) {
      warnings.push({ type: 'work_limit', date, employeeId, minutes: plannedWorkMinutes(entriesOf(date)) })
    }
  }
  return warnings
}

// ---- retention ----------------------------------------------------------------

/**
 * The day a case's records count from: its end (maternityLastDay, before today); a case still running of an employee
 * who has left counts from the leaving day. null while it runs.
 */
function retentionStart(row: CaseRow, leftOn: IsoDate | null, today: IsoDate): IsoDate | null {
  const last = maternityLastDay(row)
  if (last < today) return last
  return leftOn !== null && leftOn < today ? leftOn : null
}

/** The employee's cases with an end: the day each counts from and may be deleted from (+ the years), earliest first. */
export function maternityDeletableDates(
  db: Db, employeeId: number, leftOn: IsoDate | null, today: IsoDate, years: number,
): { endedOn: IsoDate; from: IsoDate }[] {
  return casesOf(db, [employeeId])
    .flatMap((row) => {
      const endedOn = retentionStart(row, leftOn, today)
      return endedOn === null ? [] : [{ endedOn, from: addMonths(endedOn, years * 12) }]
    })
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

/** The employees (any facility) with at least one Mutterschutz case. */
export function employeesWithMaternity(db: Db): number[] {
  return db.selectDistinct({ id: maternityCases.employeeId }).from(maternityCases).all().map(row => row.id)
}

/** Deletes the employee's cases that may be deleted today; answers how many. */
export function deleteDueMaternityCases(db: Db, employeeId: number, leftOn: IsoDate | null, today: IsoDate, years: number): number {
  const due = casesOf(db, [employeeId]).filter((row) => {
    const start = retentionStart(row, leftOn, today)
    return start !== null && addMonths(start, years * 12) <= today
  })
  for (const row of due) deleteMaternityAcks(db, row)
  return due.length === 0 ? 0 : db.delete(maternityCases).where(inArray(maternityCases.id, due.map(row => row.id))).run().changes
}
