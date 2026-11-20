import { and, asc, desc, eq, inArray, max, ne } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import {
  BUILTIN_REQUIREMENTS, EARLIEST_REQUIREMENT_DATE, LATEST_TRAINING_DATE, isYouthExamKey, requirementState, type RequirementState,
} from '../../shared/domain/requirements'
import { employmentStart, isEmployedOn } from '../../shared/domain/targets'
import { youthExamStatus, youthFollowupBanFrom, youthFollowupBanOn } from '../../shared/domain/youthProtection'
import type { IsoDate } from '../../shared/domain/types'
import type {
  DueRequirementDto, EmployeeRequirementsDto, MyRequirementsDto, RequirementTypeDto, SessionUser, TrainingDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeRequirements, employeeTrainings, employees, requirementTypes } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadEmployee, loadEmployees, type EmployeeRecord } from './queries'
import { birthYearsOf } from './youthProtection'

type TypeRow = typeof requirementTypes.$inferSelect

export interface RequirementTypeInput {
  name: string
  /** Due again every this many months (null = needed once). */
  intervalMonths: number | null
}

export interface RequirementRecordInput {
  typeId: number
  date: IsoDate
  note?: string | null
}

export interface TrainingInput {
  date: IsoDate
  title: string
  note?: string | null
}

function toTypeDto(row: TypeRow): RequirementTypeDto {
  return { id: row.id, name: row.name, intervalMonths: row.intervalMonths, builtinKey: row.builtinKey, sortOrder: row.sortOrder }
}

function typeRows(db: Db, facilityId: number): TypeRow[] {
  return db.select().from(requirementTypes).where(eq(requirementTypes.facilityId, facilityId))
    .orderBy(asc(requirementTypes.sortOrder), asc(requirementTypes.id)).all()
}

/** The facility's kinds of mandatory appointments in their order: the built-in ones, then its own. */
export function listRequirementTypes(db: Db, facilityId: number): RequirementTypeDto[] {
  return typeRows(db, facilityId).map(toTypeDto)
}

/** Gives a new facility the built-in kinds with their default names and intervals. */
export function seedBuiltinRequirementTypes(db: Db, facilityId: number): void {
  db.insert(requirementTypes).values(BUILTIN_REQUIREMENTS.map((kind, sortOrder) => ({
    facilityId, name: kind.name, intervalMonths: kind.intervalMonths, builtinKey: kind.key, sortOrder,
  }))).run()
}

// In JS, not SQLite's lower(), which only folds ASCII letters (Ä ≠ ä).
const folded = (value: string) => value.trim().toLocaleLowerCase('de')

/** Trimmed, non-empty name no other kind of the facility uses (compared case-insensitively, umlauts included). */
function checkedName(db: Db, facilityId: number, name: string, exceptId: number | null = null): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'requirement_name_required')
  if (typeRows(db, facilityId).some(row => row.id !== exceptId && folded(row.name) === folded(trimmed))) {
    throw new ServiceError(409, 'requirement_name_taken')
  }
  return trimmed
}

/** The facility's kind with this id; otherwise 404 requirement_type_not_found (other facilities' ids stay unconfirmed). */
function ownType(db: Db, facilityId: number, id: number): TypeRow {
  const row = db.select().from(requirementTypes)
    .where(and(eq(requirementTypes.id, id), eq(requirementTypes.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'requirement_type_not_found')
  return row
}

function nextSortOrder(db: Db, facilityId: number): number {
  return (db.select({ value: max(requirementTypes.sortOrder) }).from(requirementTypes)
    .where(eq(requirementTypes.facilityId, facilityId)).get()?.value ?? -1) + 1
}

/** A new kind of the facility's own, at the end of its order. */
export function createRequirementType(db: Db, facilityId: number, input: RequirementTypeInput): RequirementTypeDto {
  const name = checkedName(db, facilityId, input.name)
  return toTypeDto(db.insert(requirementTypes)
    .values({ facilityId, name, intervalMonths: input.intervalMonths, sortOrder: nextSortOrder(db, facilityId) }).returning().get())
}

/**
 * Renames a kind and sets its interval; built-in kinds too (they stay built-in). The examinations of the JArbSchG keep
 * no interval: the law sets when they are due.
 */
export function updateRequirementType(db: Db, facilityId: number, id: number, input: RequirementTypeInput): void {
  const type = ownType(db, facilityId, id)
  const name = checkedName(db, facilityId, input.name, id)
  const intervalMonths = isYouthExamKey(type.builtinKey) ? null : input.intervalMonths
  db.update(requirementTypes).set({ name, intervalMonths }).where(eq(requirementTypes.id, id)).run()
}

/** What the state of a kind needs of an employee besides the records: the examinations of the JArbSchG ask for the age. */
interface StateFacts {
  birthday: string | null
  birthYear: number | null
  /** Start of employment: „beschäftigt seit“, else the first weekly hours. */
  start: IsoDate | null
}

function stateFactsOf(employee: EmployeeRecord, birthYear: number | null): StateFacts {
  return { birthday: employee.birthday, birthYear, start: employee.employedSince ?? employmentStart(employee.info) }
}

/**
 * The state of a kind for an employee whose newest record is dated `lastDate`; null when the kind does not apply to them:
 * an examination of the JArbSchG only for someone under 18 at its day and still today, or with a record (youthExamStatus).
 */
function kindState(
  type: TypeRow, lastDate: IsoDate | null, facts: StateFacts, today: IsoDate,
): { state: RequirementState; dueOn: IsoDate | null } | null {
  return isYouthExamKey(type.builtinKey)
    ? youthExamStatus(type.builtinKey, facts, lastDate, today)
    : requirementState(lastDate, type.intervalMonths, today)
}

/** Deletes one of the facility's own kinds; its records go with it (ON DELETE CASCADE). Built-in kinds stay: 409 requirement_builtin. */
export function deleteRequirementType(db: Db, facilityId: number, id: number): void {
  if (ownType(db, facilityId, id).builtinKey !== null) throw new ServiceError(409, 'requirement_builtin')
  db.delete(requirementTypes).where(eq(requirementTypes.id, id)).run()
}

/**
 * The employee must be one of the facility's own staff (a helper from another facility is not); otherwise 404
 * employee_not_found. The rule of assertEmployee in employees.ts, which cannot be imported here: it imports this service.
 */
function assertHomeEmployee(db: Db, facilityId: number, employeeId: number): void {
  const row = db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'employee_not_found')
}

/**
 * A real calendar day from 1900 on; otherwise 400 invalid_date. A mistyped year (0202 for 2020) would otherwise count as
 * a record, and settle a kind that is needed once for good.
 */
function checkedDate(date: string): IsoDate {
  if (!isValidIsoDate(date) || date < EARLIEST_REQUIREMENT_DATE) throw new ServiceError(400, 'invalid_date')
  return date
}

/** An optional text: trimmed, and null when nothing is left. */
function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null
}

const newestFirst = <T extends { date: IsoDate; id: number }>(a: T, b: T) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1)

/**
 * Every kind of the facility as it stands for one of its employees (state, newest record, due date, history) and the
 * employee's trainings, both newest first. The examinations of the JArbSchG only when they apply (kindState).
 */
export function getEmployeeRequirements(db: Db, facilityId: number, employeeId: number, today: IsoDate): EmployeeRequirementsDto {
  assertHomeEmployee(db, facilityId, employeeId)
  const facts = stateFactsOf(loadEmployee(db, employeeId)!, birthYearsOf(db, [employeeId]).get(employeeId) ?? null)
  const records = db.select().from(employeeRequirements).where(eq(employeeRequirements.employeeId, employeeId)).all().sort(newestFirst)
  const trainings: TrainingDto[] = db.select().from(employeeTrainings).where(eq(employeeTrainings.employeeId, employeeId)).all()
    .sort(newestFirst).map(({ id, date, title, note }) => ({ id, date, title, note }))
  return {
    kinds: typeRows(db, facilityId).flatMap((type) => {
      const history = records.filter(record => record.typeId === type.id)
      const lastDate = history[0]?.date ?? null
      const state = kindState(type, lastDate, facts, today)
      // § 33 Abs. 3 JArbSchG: the follow-up kind tells when the employment ban applies today.
      const banFrom = youthFollowupBanFrom(facts.start, lastDate !== null)
      const ban = type.builtinKey === 'youth_followup' && banFrom !== null && youthFollowupBanOn(facts, lastDate !== null, today)
      return state === null
        ? []
        : [{
            type: toTypeDto(type), ...state, lastDate, records: history.map(({ id, date, note }) => ({ id, date, note })),
            ...(ban ? { employmentBanFrom: banFrom } : {}),
          }]
    }),
    trainings,
  }
}

/**
 * Enters an appointment kept or a proof shown; the kind must be one of the employee's facility. Only what has happened
 * counts: a date after `today` (the Berlin date) is refused with 400 date_in_future, as a planned appointment would
 * otherwise clear the notice early. Returns the record's id.
 */
export function addRequirementRecord(
  db: Db, facilityId: number, employeeId: number, input: RequirementRecordInput, today: IsoDate,
): number {
  assertHomeEmployee(db, facilityId, employeeId)
  ownType(db, facilityId, input.typeId)
  const date = checkedDate(input.date)
  if (date > today) throw new ServiceError(400, 'date_in_future')
  return db.insert(employeeRequirements).values({ employeeId, typeId: input.typeId, date, note: optionalText(input.note) })
    .returning({ id: employeeRequirements.id }).get().id
}

/** Deletes a single record of one of the facility's employees; otherwise 404 requirement_not_found. */
export function deleteRequirementRecord(db: Db, facilityId: number, id: number): void {
  const row = db.select({ id: employeeRequirements.id }).from(employeeRequirements)
    .innerJoin(employees, eq(employeeRequirements.employeeId, employees.id))
    .where(and(eq(employeeRequirements.id, id), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'requirement_not_found')
  db.delete(employeeRequirements).where(eq(employeeRequirements.id, id)).run()
}

function checkedTraining(input: TrainingInput): { date: IsoDate; title: string; note: string | null } {
  const title = input.title.trim()
  if (!title) throw new ServiceError(400, 'title_required')
  const date = checkedDate(input.date)
  if (date > LATEST_TRAINING_DATE) throw new ServiceError(400, 'invalid_date')
  return { date, title, note: optionalText(input.note) }
}

/** The training must be one of an employee of the facility; otherwise 404 training_not_found. */
function assertTraining(db: Db, facilityId: number, id: number): void {
  const row = db.select({ id: employeeTrainings.id }).from(employeeTrainings)
    .innerJoin(employees, eq(employeeTrainings.employeeId, employees.id))
    .where(and(eq(employeeTrainings.id, id), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'training_not_found')
}

/** Adds a training of one of the facility's employees; returns its id. */
export function addTraining(db: Db, facilityId: number, employeeId: number, input: TrainingInput): number {
  assertHomeEmployee(db, facilityId, employeeId)
  return db.insert(employeeTrainings).values({ employeeId, ...checkedTraining(input) })
    .returning({ id: employeeTrainings.id }).get().id
}

export function updateTraining(db: Db, facilityId: number, id: number, input: TrainingInput): void {
  assertTraining(db, facilityId, id)
  db.update(employeeTrainings).set(checkedTraining(input)).where(eq(employeeTrainings.id, id)).run()
}

export function deleteTraining(db: Db, facilityId: number, id: number): void {
  assertTraining(db, facilityId, id)
  db.delete(employeeTrainings).where(eq(employeeTrainings.id, id)).run()
}

const DUE_ORDER: Record<DueRequirementDto['state'], number> = { overdue: 0, missing: 1, soon: 2 }

/**
 * The notice for Leitung and Träger: every kind that is overdue, missing or due soon for one of the facility's own
 * employees who is employed today (not before the first day, not after leftOn; helpers never). Only the first
 * examination of the JArbSchG (§ 32) shows before the first day already: it is due by then. Overdue first, then
 * missing, then soon; within a state by employee name, then in the order of the kinds.
 */
export function listDueRequirements(db: Db, facilityId: number, today: IsoDate): DueRequirementDto[] {
  // Not employed yet, starting later (the start the examination is due by: stateFactsOf).
  const upcoming = (employee: EmployeeRecord) => !isEmployedOn(employee.info, today)
    && (stateFactsOf(employee, null).start ?? '') > today && (employee.info.leftOn === null || employee.info.leftOn >= today)
  const staff = loadEmployees(db, facilityId).filter(employee => isEmployedOn(employee.info, today) || upcoming(employee))
  if (staff.length === 0) return []
  const types = typeRows(db, facilityId)
  const newest = new Map(db.select({
    employeeId: employeeRequirements.employeeId, typeId: employeeRequirements.typeId, date: max(employeeRequirements.date),
  }).from(employeeRequirements)
    .where(inArray(employeeRequirements.employeeId, staff.map(employee => employee.id)))
    .groupBy(employeeRequirements.employeeId, employeeRequirements.typeId).all()
    .map(row => [`${row.employeeId}:${row.typeId}`, row.date]))
  const birthYears = birthYearsOf(db, staff.map(employee => employee.id))
  const rows = staff.flatMap((employee) => {
    const facts = stateFactsOf(employee, birthYears.get(employee.id) ?? null)
    const notYet = upcoming(employee)
    return types.flatMap((type, typeIndex) => {
      if (notYet && type.builtinKey !== 'youth_initial') return []
      const status = kindState(type, newest.get(`${employee.id}:${type.id}`) ?? null, facts, today)
      if (status === null || status.state === 'ok') return []
      const { state, dueOn } = status
      const row: DueRequirementDto = { employeeId: employee.id, employeeName: employee.name, typeId: type.id, typeName: type.name, state, dueOn }
      return [{ row, typeIndex }]
    })
  })
  return rows.sort((a, b) => DUE_ORDER[a.row.state] - DUE_ORDER[b.row.state]
    || a.row.employeeName.localeCompare(b.row.employeeName, 'de')
    || a.row.employeeId - b.row.employeeId
    || a.typeIndex - b.typeIndex).map(({ row }) => row)
}

/**
 * The viewer's own mandatory appointments and trainings, in their employee's home facility (403 no_employee without one).
 * Only the plain dates: every field is picked by name, so the state, the history and the notes of the Leitung (and
 * whatever the manager's view gains later) never reach the employee.
 */
export function getMyRequirements(db: Db, viewer: SessionUser, today: IsoDate): MyRequirementsDto {
  const employee = viewer.employeeId === null
    ? undefined
    : db.select({ id: employees.id, facilityId: employees.facilityId }).from(employees).where(eq(employees.id, viewer.employeeId)).get()
  if (!employee) throw new ServiceError(403, 'no_employee')
  const { kinds, trainings } = getEmployeeRequirements(db, employee.facilityId, employee.id, today)
  return {
    kinds: kinds.map(({ type, lastDate, dueOn }) => ({
      type: { id: type.id, name: type.name, intervalMonths: type.intervalMonths }, lastDate, dueOn,
    })),
    trainings: trainings.map(({ id, date, title }) => ({ id, date, title })),
  }
}

/**
 * Part of moving an employee to facilityId (runs in the move's transaction): their records follow them onto the new
 * facility's kinds. A built-in kind's records go to the kind with the same key, whatever it is called there; an own
 * kind's records go to the kind of the same name, which is created with the same interval when missing. The old
 * facility keeps its kinds. Trainings hang on the employee and need nothing.
 */
export function moveRequirementRecords(db: Db, employeeId: number, facilityId: number): void {
  const sources = db.select().from(requirementTypes).where(and(
    ne(requirementTypes.facilityId, facilityId),
    inArray(requirementTypes.id, db.select({ id: employeeRequirements.typeId }).from(employeeRequirements)
      .where(eq(employeeRequirements.employeeId, employeeId))),
  )).orderBy(asc(requirementTypes.sortOrder), asc(requirementTypes.id)).all()
  for (const source of sources) {
    // Read again for every kind: one created for the kind before counts.
    const targets = typeRows(db, facilityId)
    const target = (source.builtinKey === null ? undefined : targets.find(type => type.builtinKey === source.builtinKey))
      ?? targets.find(type => folded(type.name) === folded(source.name))
      ?? db.insert(requirementTypes).values({
        facilityId, name: source.name, intervalMonths: source.intervalMonths, builtinKey: source.builtinKey,
        sortOrder: nextSortOrder(db, facilityId),
      }).returning().get()
    db.update(employeeRequirements).set({ typeId: target.id })
      .where(and(eq(employeeRequirements.employeeId, employeeId), eq(employeeRequirements.typeId, source.id))).run()
  }
}
