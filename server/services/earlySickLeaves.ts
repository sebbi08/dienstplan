import { and, asc, eq, gte, inArray, isNotNull, lte, max } from 'drizzle-orm'
import { hasPlannedDuty } from '../../shared/domain/balance'
import { cellKey } from '../../shared/domain/cells'
import { todayIso } from '../../shared/domain/dates'
import { describeCell } from '../../shared/domain/describe'
import type { IsoDate } from '../../shared/domain/types'
import type { EarlySickLeaveInput, EarlySickLeavesDto, EntryDto, SessionUser, SickLeaveMarkDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { earlySickLeaves, employees, timeRecords } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertEmployee } from './employees'
import { loadEmployees, loadEntries } from './queries'
import { withPlainMarkers } from './release'

// "Im Dienst erkrankt": someone fell ill during the duty of a day and went home early. The day is no sick day: the duty
// stays in the plan and its planned working time is credited in full (see ActualTime.plannedDates). The marker is kept
// per person and day, entered and seen only by the managers of the person's home facility, and is never part of a
// release. A day that loses its working time loses its marker (dropStaleSickLeave in the entries service).

/** A marker with its day and the effective time of leaving. */
export interface SickLeaveMark extends SickLeaveMarkDto {
  employeeId: number
  date: IsoDate
}

/**
 * The markers of the given employees in [from, to], oldest first, with the effective time of leaving: the entered
 * time, otherwise the end of the day's last closed time record, otherwise unknown.
 */
export function loadSickLeaves(db: Db, employeeIds: number[], from: IsoDate, to: IsoDate): SickLeaveMark[] {
  if (employeeIds.length === 0) return []
  const rows = db.select().from(earlySickLeaves)
    .where(and(inArray(earlySickLeaves.employeeId, employeeIds), gte(earlySickLeaves.date, from), lte(earlySickLeaves.date, to)))
    .orderBy(asc(earlySickLeaves.date), asc(earlySickLeaves.id)).all()
  if (rows.length === 0) return []
  const lastEnd = new Map(db.select({ employeeId: timeRecords.employeeId, date: timeRecords.date, end: max(timeRecords.end) })
    .from(timeRecords)
    .where(and(
      inArray(timeRecords.employeeId, [...new Set(rows.map(row => row.employeeId))]),
      gte(timeRecords.date, from), lte(timeRecords.date, to), isNotNull(timeRecords.end),
    ))
    .groupBy(timeRecords.employeeId, timeRecords.date).all()
    .map(row => [cellKey(row.employeeId, row.date), row.end]))
  return rows.map((row) => {
    const recorded = lastEnd.get(cellKey(row.employeeId, row.date)) ?? null
    return {
      id: row.id, employeeId: row.employeeId, date: row.date,
      leftAt: row.leftAt ?? recorded, leftAtFromRecord: row.leftAt === null && recorded !== null, note: row.note,
    }
  })
}

/** The markers as the pages show them per cell (cellKey → marker). */
export function sickLeavesByCell(marks: SickLeaveMark[]): Record<string, SickLeaveMarkDto> {
  return Object.fromEntries(marks.map(({ employeeId, date, ...mark }) => [cellKey(employeeId, date), mark]))
}

/** Per employee of the facility: the marked days from `from` on, which are credited from the plan. */
export function sickLeaveDates(db: Db, facilityId: number, from: IsoDate): Map<number, Set<IsoDate>> {
  const dates = new Map<number, Set<IsoDate>>()
  const rows = db.select({ employeeId: earlySickLeaves.employeeId, date: earlySickLeaves.date }).from(earlySickLeaves)
    .innerJoin(employees, eq(earlySickLeaves.employeeId, employees.id))
    .where(and(eq(employees.facilityId, facilityId), gte(earlySickLeaves.date, from))).all()
  for (const row of rows) {
    const own = dates.get(row.employeeId) ?? new Set<IsoDate>()
    own.add(row.date)
    dates.set(row.employeeId, own)
  }
  return dates
}

/** The planned duty of a day as short text ("F2 7:30–15:45"; several duties joined, breaks left out). */
function describeDuty(dayEntries: EntryDto[]): string {
  return describeCell(dayEntries.filter(entry => entry.kind !== 'break')
    .map(entry => ({ label: [entry.shortLabel, entry.label].filter(Boolean).join(' ') })))
}

/** The year's markers of the facility's staff (everyone whose home facility it is now), newest first, and the counts. */
export function listEarlySickLeaves(db: Db, facilityId: number, year: number): EarlySickLeavesDto {
  const staff = loadEmployees(db, facilityId)
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const marks = loadSickLeaves(db, staff.map(employee => employee.id), from, to)
  if (marks.length === 0) return { rows: [], totals: [] }
  const order = new Map(staff.map((employee, index) => [employee.id, index]))
  const names = new Map(staff.map(employee => [employee.id, employee.name]))
  const marked = [...new Set(marks.map(mark => mark.employeeId))]
  // A help-out elsewhere shows as the home plan shows it: its times only.
  const entriesByCell = Map.groupBy(
    withPlainMarkers(facilityId, loadEntries(db, { employeeIds: marked, from, to })), entry => cellKey(entry.employeeId, entry.date),
  )
  return {
    rows: marks
      .sort((a, b) => b.date.localeCompare(a.date) || order.get(a.employeeId)! - order.get(b.employeeId)!)
      .map(({ employeeId, date, ...mark }) => ({
        ...mark, employeeId, employeeName: names.get(employeeId)!, date,
        duty: describeDuty(entriesByCell.get(cellKey(employeeId, date)) ?? []),
      })),
    totals: staff
      .map(employee => ({
        employeeId: employee.id, employeeName: employee.name, count: marks.filter(mark => mark.employeeId === employee.id).length,
      }))
      .filter(total => total.count > 0),
  }
}

/**
 * Marks the day of one of the facility's own staff, or replaces the time and note of its marker. The day must not lie
 * in the future and needs planned working time without a full-day absence (in the home plan or as a help-out elsewhere).
 */
export function saveEarlySickLeave(
  db: Db, actor: SessionUser, facilityId: number, input: EarlySickLeaveInput, now: Date = new Date(),
): void {
  const { employeeId, date, leftAt } = input
  assertEmployee(db, facilityId, employeeId)
  if (date > todayIso(now)) throw new ServiceError(400, 'date_in_future')
  if (leftAt !== null && (!Number.isInteger(leftAt) || leftAt < 0 || leftAt >= 24 * 60)) throw new ServiceError(400, 'invalid_time')
  const note = input.note?.trim() || null
  db.transaction((tx) => {
    if (!hasPlannedDuty(loadEntries(tx, { employeeId, from: date, to: date }))) throw new ServiceError(400, 'no_duty_planned')
    tx.insert(earlySickLeaves).values({ employeeId, date, leftAt, note, createdAt: now.toISOString(), createdBy: actor.id })
      .onConflictDoUpdate({ target: [earlySickLeaves.employeeId, earlySickLeaves.date], set: { leftAt, note } }).run()
  })
}

/** Removes a marker of the facility's own staff; any other id gives early_sick_leave_not_found. */
export function deleteEarlySickLeave(db: Db, facilityId: number, id: number): void {
  const own = db.select({ id: earlySickLeaves.id }).from(earlySickLeaves)
    .innerJoin(employees, eq(earlySickLeaves.employeeId, employees.id))
    .where(and(eq(earlySickLeaves.id, id), eq(employees.facilityId, facilityId))).get()
  if (!own) throw new ServiceError(404, 'early_sick_leave_not_found')
  db.delete(earlySickLeaves).where(eq(earlySickLeaves.id, id)).run()
}
