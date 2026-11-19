import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import {
  BEM_DEFAULT_INVITATION_TEXT, BEM_LIMITS, BEM_SEND_REMINDER_DAYS, bemAnswerBy, bemEndDate, bemLimit, bemWindow, countBemSickDays,
  fillBemInvitationText, isBemOpen, type BemAnswer, type BemMeasureStatus, type BemStepKind,
} from '../../shared/domain/bem'
import { addDays } from '../../shared/domain/dates'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { addMonths } from '../../shared/domain/requirements'
import { isEmployedOn, isWorkday, workdayCount, workdaysOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type {
  BemInvitationDto, BemProcessDto, BemSettingsDto, BemSickDaysDto, BemStepDto, EmployeeBemDto, ReminderDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { bemProcesses, bemSteps, employees, facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { facilityContactData } from './facilityContact'
import { actorName } from './formTemplates'
import { loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'
import { getRetentionSettings } from './retentionSettings'

// Betriebliches Eingliederungsmanagement (§ 167 Abs. 2 SGB IX). Health data: only for whoever has employees.sickness
// (Leitung and Träger by default), in the employee's home facility, never about themselves (a Leitung's BEM is run by
// the Träger), never for the employee, never at the tablet. The routes pass the scope
// `{ facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }`.

export interface BemScope { facilityId: number; ownEmployeeId: number | null }

type ProcessRow = typeof bemProcesses.$inferSelect
type StepRow = typeof bemSteps.$inferSelect

const isOwn = (scope: BemScope, employeeId: number) => scope.ownEmployeeId !== null && scope.ownEmployeeId === employeeId

/** An employee of the facility (404 employee_not_found), not the viewer themselves (403 bem_own). */
function assertEmployeeInScope(db: Db, scope: BemScope, employeeId: number): void {
  const row = db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, scope.facilityId))).get()
  if (!row) throw new ServiceError(404, 'employee_not_found')
  if (isOwn(scope, employeeId)) throw new ServiceError(403, 'bem_own')
}

/** A process of an employee of the facility, not about the viewer; anything else is 404 bem_not_found (no existence leak). */
function loadProcess(db: Db, scope: BemScope, id: number): ProcessRow {
  const row = db.select({ process: bemProcesses }).from(bemProcesses)
    .innerJoin(employees, eq(employees.id, bemProcesses.employeeId))
    .where(and(eq(bemProcesses.id, id), eq(employees.facilityId, scope.facilityId))).get()
  if (!row || isOwn(scope, row.process.employeeId)) throw new ServiceError(404, 'bem_not_found')
  return row.process
}

/** A step of such a process; anything else is 404 bem_step_not_found. */
function loadStep(db: Db, scope: BemScope, stepId: number): { step: StepRow; process: ProcessRow } {
  const row = db.select({ step: bemSteps, process: bemProcesses }).from(bemSteps)
    .innerJoin(bemProcesses, eq(bemProcesses.id, bemSteps.processId))
    .innerJoin(employees, eq(employees.id, bemProcesses.employeeId))
    .where(and(eq(bemSteps.id, stepId), eq(employees.facilityId, scope.facilityId))).get()
  if (!row || isOwn(scope, row.process.employeeId)) throw new ServiceError(404, 'bem_step_not_found')
  return row
}

function toStepDto(row: StepRow): BemStepDto {
  return { id: row.id, kind: row.kind, date: row.date, participants: row.participants, text: row.text, status: row.status }
}

function toProcessDto(row: ProcessRow, steps: StepRow[]): BemProcessDto {
  return {
    id: row.id, status: row.status, createdOn: row.createdAt.slice(0, 10), createdBy: row.createdBy, invitedOn: row.invitedOn,
    answeredOn: row.answeredOn, completedOn: row.completedOn, steps: steps.map(toStepDto),
  }
}

/** The steps of the processes, by date (then as entered), by process id. */
function stepsByProcess(db: Db, processIds: number[]): Map<number, StepRow[]> {
  const result = new Map<number, StepRow[]>()
  if (processIds.length === 0) return result
  for (const row of db.select().from(bemSteps).where(inArray(bemSteps.processId, processIds))
    .orderBy(asc(bemSteps.date), asc(bemSteps.id)).all()) {
    result.set(row.processId, [...result.get(row.processId) ?? [], row])
  }
  return result
}

/** The processes of the employees, newest first. */
function processesOf(db: Db, employeeIds: number[]): ProcessRow[] {
  if (employeeIds.length === 0) return []
  return db.select().from(bemProcesses).where(inArray(bemProcesses.employeeId, employeeIds))
    .orderBy(desc(bemProcesses.createdAt), desc(bemProcesses.id)).all()
}

/** The end of the employee's last ended process (counting starts afresh after it); null without one. */
function lastEnd(processes: ProcessRow[]): IsoDate | null {
  let latest: IsoDate | null = null
  for (const process of processes) {
    const end = bemEndDate(process)
    if (end !== null && (latest === null || end > latest)) latest = end
  }
  return latest
}

/**
 * The sick working days the BEM counts for the employee today: „Krank“ entries (not „Kind krank“, not „im Dienst
 * erkrankt“) on working days, in the last 12 months but only after the last ended BEM; the limit from the working days
 * per week of the hours period valid today. `sickDates` are the employee's „Krank“ days (at least the window).
 */
function sickDaysOf(employee: EmployeeRecord, sickDates: IsoDate[], restartAfter: IsoDate | null, today: IsoDate): BemSickDaysDto {
  const window = bemWindow(today, restartAfter)
  const workdaysPerWeek = workdayCount(workdaysOn(employee.info, today))
  return {
    days: countBemSickDays(sickDates, date => isWorkday(employee.info, date), window),
    limit: bemLimit(workdaysPerWeek), workdaysPerWeek, from: window.from, to: window.to,
    restartAfter: restartAfter !== null && addDays(restartAfter, 1) === window.from ? restartAfter : null,
  }
}

/** The „Krank“ days of the employees of the facility from `from` to `to`, by employee. */
function sickDatesByEmployee(db: Db, facilityId: number, from: IsoDate, to: IsoDate): Map<number, IsoDate[]> {
  const result = new Map<number, IsoDate[]>()
  for (const entry of loadEntries(db, { homeFacilityId: facilityId, codeKey: 'sick', from, to })) {
    result.set(entry.employeeId, [...result.get(entry.employeeId) ?? [], entry.date])
  }
  return result
}

/** The employee page's BEM part: the count, the running process and the earlier ones (403 bem_own, 404 employee_not_found). */
export function getEmployeeBem(db: Db, scope: BemScope, employeeId: number, today: IsoDate): EmployeeBemDto {
  assertEmployeeInScope(db, scope, employeeId)
  const employee = loadEmployee(db, employeeId)!
  const processes = processesOf(db, [employeeId])
  const steps = stepsByProcess(db, processes.map(process => process.id))
  const sickDates = loadEntries(db, { employeeId, codeKey: 'sick', from: addDays(today, -364), to: today }).map(entry => entry.date)
  const open = processes.find(process => isBemOpen(process.status))
  return {
    sickDays: sickDaysOf(employee, sickDates, lastEnd(processes), today),
    open: open ? toProcessDto(open, steps.get(open.id) ?? []) : null,
    history: processes.filter(process => !isBemOpen(process.status)).map(process => toProcessDto(process, steps.get(process.id) ?? [])),
  }
}

/** „BEM einleiten“: a new process (status invited, no letter sent yet); 409 bem_open_exists while one is running. */
export function startBem(db: Db, actor: SessionUser, scope: BemScope, employeeId: number, now: Date = new Date()): number {
  assertEmployeeInScope(db, scope, employeeId)
  if (processesOf(db, [employeeId]).some(process => isBemOpen(process.status))) throw new ServiceError(409, 'bem_open_exists')
  const at = now.toISOString()
  return db.insert(bemProcesses).values({ employeeId, status: 'invited', createdBy: actorName(db, actor), createdAt: at, updatedAt: at })
    .returning({ id: bemProcesses.id }).get().id
}

/** 400 bem_date_future for a day after today. */
function assertNotFuture(date: IsoDate, today: IsoDate): void {
  if (date > today) throw new ServiceError(400, 'bem_date_future')
}

/** 400 bem_date_order when the day lies before one of the earlier days of the process. */
function assertNotBefore(date: IsoDate, ...earlier: (IsoDate | null)[]): void {
  if (earlier.some(day => day !== null && date < day)) throw new ServiceError(400, 'bem_date_order')
}

/** Writes the fields only if the process is still in `from` (409 bem_state_invalid otherwise, e.g. changed in between). */
function transition(db: Db, process: ProcessRow, from: ProcessRow['status'][], values: Partial<ProcessRow>, now: Date): void {
  if (!from.includes(process.status)) throw new ServiceError(409, 'bem_state_invalid')
  const result = db.update(bemProcesses).set({ ...values, updatedAt: now.toISOString() })
    .where(and(eq(bemProcesses.id, process.id), eq(bemProcesses.status, process.status))).run()
  if (result.changes !== 1) throw new ServiceError(409, 'bem_state_invalid')
}

/**
 * „Verschickt am“ (changing it is fine, clearing it is not: the offer is the evidence): only while no answer is entered
 * (409 bem_state_invalid); not after today.
 */
export function setBemSent(db: Db, scope: BemScope, id: number, invitedOn: IsoDate, today: IsoDate, now: Date = new Date()): void {
  const process = loadProcess(db, scope, id)
  assertNotFuture(invitedOn, today)
  transition(db, process, ['invited'], { invitedOn }, now)
}

/**
 * The answer, dated (not after today, not before the letter was sent): „angenommen“ while invited (also an oral
 * acceptance before the letter); „abgelehnt“ while invited, or later while accepted (the consent withdrawn: the day of
 * the answer stays); „keine Antwort“ while invited. Declined and no answer end the process on that day (the status is
 * kept as evidence) and restart the counting, so they need a documented offer: „Verschickt am“ first (409 bem_not_sent),
 * and „keine Antwort“ only from the day the answer was asked by (400 bem_answer_too_early). 409 bem_state_invalid
 * otherwise.
 */
export function answerBem(
  db: Db, scope: BemScope, id: number, answer: BemAnswer, date: IsoDate, today: IsoDate, now: Date = new Date(),
): void {
  const process = loadProcess(db, scope, id)
  assertNotFuture(date, today)
  assertNotBefore(date, process.invitedOn)
  if (answer === 'accepted') return transition(db, process, ['invited'], { status: 'accepted', answeredOn: date }, now)
  if (answer === 'declined' && process.status === 'accepted') {
    assertNotBefore(date, process.answeredOn)
    return transition(db, process, ['accepted'], { status: 'declined', completedOn: date }, now)
  }
  if (process.status !== 'invited') throw new ServiceError(409, 'bem_state_invalid')
  if (process.invitedOn === null) throw new ServiceError(409, 'bem_not_sent')
  if (answer === 'no_answer' && date < bemAnswerBy(process.invitedOn)) {
    throw new ServiceError(400, 'bem_answer_too_early', { answerBy: bemAnswerBy(process.invitedOn) })
  }
  transition(db, process, ['invited'], { status: answer, answeredOn: date, completedOn: date }, now)
}

/** „Abschließen“ of an accepted process, dated (not after today, not before the answer); 409 bem_state_invalid otherwise. */
export function completeBem(db: Db, scope: BemScope, id: number, date: IsoDate, today: IsoDate, now: Date = new Date()): void {
  const process = loadProcess(db, scope, id)
  assertNotFuture(date, today)
  assertNotBefore(date, process.invitedOn, process.answeredOn)
  transition(db, process, ['accepted'], { status: 'completed', completedOn: date }, now)
}

/**
 * Deletes a process started by mistake, with its steps: only while nothing is answered (409 bem_state_invalid) and the
 * invitation has not been sent (409 bem_already_sent: that offer is the evidence; enter the answer instead).
 */
export function deleteBem(db: Db, scope: BemScope, id: number): void {
  const process = loadProcess(db, scope, id)
  if (process.status !== 'invited') throw new ServiceError(409, 'bem_state_invalid')
  if (process.invitedOn !== null) throw new ServiceError(409, 'bem_already_sent')
  db.delete(bemProcesses).where(and(eq(bemProcesses.id, id), eq(bemProcesses.status, 'invited'), isNull(bemProcesses.invitedOn))).run()
}

export interface BemStepInput {
  date: IsoDate
  participants: string
  text: string
  /** Only for a measure (default planned). */
  status: BemMeasureStatus | null
}

/** Trimmed fields: participants only for a talk, a status only for a measure, a text required for a measure and a note. */
function checkedStep(kind: BemStepKind, input: BemStepInput) {
  const participants = kind === 'meeting' ? input.participants.trim() : ''
  const text = input.text.trim()
  if (participants.length > BEM_LIMITS.participants) throw new ServiceError(400, 'bem_participants_too_long')
  if (text.length > BEM_LIMITS.text) throw new ServiceError(400, 'bem_text_too_long')
  if (kind !== 'meeting' && text === '') throw new ServiceError(400, 'bem_text_required')
  return { date: input.date, participants, text, status: kind === 'measure' ? input.status ?? 'planned' : null }
}

/** 409 bem_closed: the steps of an ended process are kept as they are (history, read-only). */
function assertOpen(process: ProcessRow): void {
  if (!isBemOpen(process.status)) throw new ServiceError(409, 'bem_closed')
}

/**
 * Adds a talk, measure or note to a running process; returns its id. Talks and measures (health contents) only once the
 * employee has accepted (409 bem_not_accepted); a note also while invited (e.g. a phone call about the letter).
 */
export function addBemStep(
  db: Db, scope: BemScope, processId: number, kind: BemStepKind, input: BemStepInput, now: Date = new Date(),
): number {
  const process = loadProcess(db, scope, processId)
  assertOpen(process)
  if (kind !== 'note' && process.status !== 'accepted') throw new ServiceError(409, 'bem_not_accepted')
  const at = now.toISOString()
  return db.insert(bemSteps).values({ processId, kind, ...checkedStep(kind, input), createdAt: at, updatedAt: at })
    .returning({ id: bemSteps.id }).get().id
}

/** Changes a step of a running process (its kind stays). */
export function updateBemStep(db: Db, scope: BemScope, stepId: number, input: BemStepInput, now: Date = new Date()): void {
  const { step, process } = loadStep(db, scope, stepId)
  assertOpen(process)
  db.update(bemSteps).set({ ...checkedStep(step.kind, input), updatedAt: now.toISOString() }).where(eq(bemSteps.id, stepId)).run()
}

/** Removes a step of a running process. */
export function deleteBemStep(db: Db, scope: BemScope, stepId: number): void {
  const { process } = loadStep(db, scope, stepId)
  assertOpen(process)
  db.delete(bemSteps).where(eq(bemSteps.id, stepId)).run()
}

/**
 * „Gesprächsnotizen löschen“ after the consent was withdrawn (or the BEM declined): the participants and texts of all its
 * steps (talks, measures and notes: any of them may hold health data) are cleared; the steps' dates, kinds and the
 * measures' status stay, as do the process's dates and status (the evidence of the offer and its end). Only for a
 * declined process (409 bem_state_invalid). Answers the steps cleared.
 */
export function clearBemNotes(db: Db, scope: BemScope, id: number, now: Date = new Date()): number {
  const process = loadProcess(db, scope, id)
  if (process.status !== 'declined') throw new ServiceError(409, 'bem_state_invalid')
  return db.update(bemSteps).set({ participants: '', text: '', updatedAt: now.toISOString() })
    .where(and(eq(bemSteps.processId, id), or(ne(bemSteps.participants, ''), ne(bemSteps.text, '')))).run().changes
}

// ---- the invitation ---------------------------------------------------------

function invitationTemplate(db: Db, facilityId: number): string | null {
  const row = db.select({ text: facilities.bemInvitationText }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row.text
}

/** The facility's invitation text (the default while it has none of its own); 404 facility_not_found. */
export function getBemSettings(db: Db, facilityId: number): BemSettingsDto {
  const text = invitationTemplate(db, facilityId)
  return { text: text ?? BEM_DEFAULT_INVITATION_TEXT, isDefaultText: text === null }
}

/** Stores the invitation text; empty or the default text itself stores „no own text“ (the default applies). */
export function setBemSettings(db: Db, facilityId: number, input: { text: string }): BemSettingsDto {
  invitationTemplate(db, facilityId)
  const text = input.text.trim()
  if (text.length > BEM_LIMITS.invitationText) throw new ServiceError(400, 'bem_text_too_long')
  db.update(facilities).set({ bemInvitationText: text === '' || text === BEM_DEFAULT_INVITATION_TEXT.trim() ? null : text })
    .where(eq(facilities.id, facilityId)).run()
  return getBemSettings(db, facilityId)
}

/**
 * The invitation of a process to print: the facility's name, Träger, address and phone as letterhead (Kontakt), the
 * employee's name, and their address only when stored and the viewer may read personal data (employees.personal;
 * otherwise blank lines), the letter's date („Verschickt am“, otherwise today), the answer date (+14 days), the
 * facility's text filled in, and the contact person for questions and the sender: the Leitung as entered in Kontakt,
 * otherwise whoever prints, with the facility's phone.
 */
export function bemInvitation(db: Db, viewer: SessionUser, scope: BemScope, id: number, today: IsoDate): BemInvitationDto {
  const process = loadProcess(db, scope, id)
  const person = db.select({ name: employees.name, street: employees.street, postalCode: employees.postalCode, city: employees.city })
    .from(employees).where(eq(employees.id, process.employeeId)).get()!
  const contact = facilityContactData(db, scope.facilityId)
  if (!contact) throw new ServiceError(404, 'facility_not_found')
  const address = can(viewer.permissions, 'employees.personal')
  const date = process.invitedOn ?? today
  const answerBy = bemAnswerBy(date)
  const template = invitationTemplate(db, scope.facilityId) ?? BEM_DEFAULT_INVITATION_TEXT
  return {
    facility: {
      name: contact.name, operator: contact.operator, street: contact.street, postalCode: contact.postalCode, city: contact.city,
      phone: contact.phone,
    },
    contact: { name: contact.manager || actorName(db, viewer), phone: contact.managerPhones[0] ?? contact.phone },
    employee: {
      name: person.name, street: address ? person.street ?? '' : '', postalCode: address ? person.postalCode ?? '' : '',
      city: address ? person.city ?? '' : '',
    },
    date, answerBy,
    text: fillBemInvitationText(template, { name: person.name, answerBy, years: getRetentionSettings(db, scope.facilityId).bemYears }),
  }
}

// ---- the reminder -------------------------------------------------------------

/**
 * The box „Erinnerungen“: for whoever has employees.sickness in the office (not at the tablet), one entry per employee
 * of the facility employed today, not the viewer themselves, without a running BEM, whose sick working days are above
 * the limit (more than 6 weeks within the counted window; stage `offer`). It goes once a BEM is started (or the days
 * drop below). A running BEM still invited comes back while it waits: `notSent` from 7 days after it was started without
 * „Verschickt am“, `answerDue` from the day after the answer date without an answer entered (both overdue after their day).
 */
export function bemReminders(
  db: Db, viewer: { facilityId: number; permissions: ReadonlySet<PermissionKey>; onTablet: boolean; employeeId: number | null },
  today: IsoDate,
): ReminderDto[] {
  if (!can(viewer.permissions, 'employees.sickness') || viewer.onTablet) return []
  const staff = loadEmployees(db, viewer.facilityId)
    .filter(employee => employee.id !== viewer.employeeId && isEmployedOn(employee.info, today))
  if (staff.length === 0) return []
  const processes = processesOf(db, staff.map(employee => employee.id))
  const sickDates = sickDatesByEmployee(db, viewer.facilityId, addDays(today, -364), today)
  const items: ReminderDto[] = []
  const push = (employee: EmployeeRecord, stage: NonNullable<ReminderDto['bem']>['stage'], date: IsoDate, days: number, limit: number) =>
    items.push({
      kind: 'bem', date, state: date < today ? 'overdue' : 'today', name: employee.name, childId: null, age: null,
      ownChild: false, canDone: false, time: null, meetingKind: null, count: days, bem: { employeeId: employee.id, days, limit, stage },
    })
  for (const employee of staff) {
    const own = processes.filter(process => process.employeeId === employee.id)
    const { days, limit } = sickDaysOf(employee, sickDates.get(employee.id) ?? [], lastEnd(own), today)
    const open = own.find(process => isBemOpen(process.status))
    if (!open) {
      if (days > limit) push(employee, 'offer', today, days, limit)
      continue
    }
    // A running BEM that waits: the invitation not sent a week after starting, or no answer entered after the answer date.
    if (open.status !== 'invited') continue
    if (open.invitedOn === null) {
      const due = addDays(open.createdAt.slice(0, 10), BEM_SEND_REMINDER_DAYS)
      if (due <= today) push(employee, 'notSent', due, days, limit)
    }
    else if (bemAnswerBy(open.invitedOn) < today) push(employee, 'answerDue', addDays(bemAnswerBy(open.invitedOn), 1), days, limit)
  }
  return items
}

// ---- retention ----------------------------------------------------------------

/** The day the retention of a process counts from: its end, or for a running one of someone who left, the leaving day. */
function retentionStart(process: Pick<ProcessRow, 'status' | 'completedOn'>, leftOn: IsoDate | null, today: IsoDate): IsoDate | null {
  return bemEndDate(process) ?? (leftOn !== null && leftOn < today ? leftOn : null)
}

/**
 * The day a process may be deleted: its end (completed, declined, no answer) plus the BEM years; a running process of
 * an employee who has left counts as ended on the leaving day. null while it runs.
 */
export function bemDeletableFrom(
  process: Pick<ProcessRow, 'status' | 'completedOn'>, leftOn: IsoDate | null, today: IsoDate, years: number,
): IsoDate | null {
  const end = retentionStart(process, leftOn, today)
  return end === null ? null : addMonths(end, years * 12)
}

/** The employee's processes with an end: the day each counts from and may be deleted from, earliest first. */
export function bemDeletableDates(
  db: Db, employeeId: number, leftOn: IsoDate | null, today: IsoDate, years: number,
): { endedOn: IsoDate; from: IsoDate }[] {
  return processesOf(db, [employeeId])
    .flatMap((process) => {
      const endedOn = retentionStart(process, leftOn, today)
      return endedOn === null ? [] : [{ endedOn, from: addMonths(endedOn, years * 12) }]
    })
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

/** The employees (any facility) with at least one BEM process. */
export function employeesWithBem(db: Db): number[] {
  return db.selectDistinct({ id: bemProcesses.employeeId }).from(bemProcesses).all().map(row => row.id)
}

/** Deletes the employee's processes that may be deleted today (with their steps); answers how many. */
export function deleteDueBemProcesses(db: Db, employeeId: number, leftOn: IsoDate | null, today: IsoDate, years: number): number {
  const due = processesOf(db, [employeeId]).filter((process) => {
    const from = bemDeletableFrom(process, leftOn, today, years)
    return from !== null && from <= today
  }).map(process => process.id)
  return due.length === 0 ? 0 : db.delete(bemProcesses).where(inArray(bemProcesses.id, due)).run().changes
}
