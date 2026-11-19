import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { dateRange } from '../../shared/domain/dates'
import { employmentStart } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { LeaveEntryKind, LeaveEntryResultDto, LeaveRemovalResultDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, entries } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { deleteEntry } from './entries'
import { bookLeaveDays, planLeaveBooking } from './leaveRequests'
import { loadClosures, loadEmployee, type EmployeeRecord } from './queries'

/** A range covers at most this many days (as a leave request). */
const MAX_RANGE_DAYS = 366

/**
 * „Urlaub eintragen“ and „Entfernen“ edit the plan of an employee of the facility (the route checks plan.edit): 404
 * employee_not_found for anyone else. Not for the own employee (they request leave), except for the Träger, who edits
 * the own plan row too (403 own_leave_entry).
 */
function requireEmployee(db: Db, actor: SessionUser, facilityId: number, employeeId: number): EmployeeRecord {
  const employee = loadEmployee(db, employeeId)
  if (!employee || employee.facilityId !== facilityId) throw new ServiceError(404, 'employee_not_found')
  if (actor.employeeId === employeeId && actor.role !== 'provider') throw new ServiceError(403, 'own_leave_entry')
  return employee
}

function checkRange(from: IsoDate, to: IsoDate): void {
  if (to < from || dateRange(from, to).length > MAX_RANGE_DAYS) throw new ServiceError(400, 'invalid_range')
}

/**
 * Enters Urlaub, Sonderurlaub or Überstundenfrei for an employee between from and to, also for past days (from the
 * first weekly hours on: 400 leave_before_employment), as approving a leave request does (planLeaveBooking): only the
 * person's working days outside closures (400 no_leave_days when the range has none), other full-day absences kept,
 * days with the same leave left as they are. Duties on the days need `overwrite` (409 cells_occupied with the number
 * of days, nothing written). Written like any plan edit (change log of released months).
 */
export function enterLeave(
  db: Db, actor: SessionUser, facilityId: number, employeeId: number,
  input: { from: IsoDate; to: IsoDate; kind: LeaveEntryKind; overwrite: boolean }, now: Date = new Date(),
): LeaveEntryResultDto {
  const employee = requireEmployee(db, actor, facilityId, employeeId)
  checkRange(input.from, input.to)
  const start = employmentStart(employee.info)
  if (start === null || input.from < start) throw new ServiceError(400, 'leave_before_employment')
  const booking = planLeaveBooking(db, employee, loadClosures(db, facilityId), input.from, input.to, input.kind)
  if (booking.requested.length === 0) throw new ServiceError(400, 'no_leave_days')
  if (booking.occupiedDays > 0 && !input.overwrite) {
    throw new ServiceError(409, 'cells_occupied', { days: booking.occupiedDays, entries: booking.occupiedByOtherEntries })
  }
  db.transaction(tx => bookLeaveDays(tx, actor, facilityId, employeeId, booking.days, input.kind, now))
  return { booked: booking.days.length, keptAbsences: booking.keptAbsences }
}

/**
 * Removes the employee's entries of that leave kind between from and to (days with them become free), nothing else:
 * duties and other absences stay, and so does the leave a closure booked (counted as keptClosureDays). Each deletion is
 * a plan edit (deleteEntry: logged in released months).
 */
export function removeLeave(
  db: Db, actor: SessionUser, facilityId: number, employeeId: number,
  input: { from: IsoDate; to: IsoDate; kind: LeaveEntryKind }, now: Date = new Date(),
): LeaveRemovalResultDto {
  requireEmployee(db, actor, facilityId, employeeId)
  checkRange(input.from, input.to)
  const rows = db.select({ id: entries.id, date: entries.date, closureId: entries.closureId })
    .from(entries).innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .where(and(
      eq(entries.employeeId, employeeId), eq(absenceCodes.key, input.kind), isNull(entries.helpFacilityId),
      gte(entries.date, input.from), lte(entries.date, input.to),
    )).all()
  const own = rows.filter(row => row.closureId === null)
  db.transaction((tx) => {
    for (const row of own) deleteEntry(tx, actor, facilityId, row.id, now)
  })
  const daysOf = (list: typeof rows) => new Set(list.map(row => row.date)).size
  return { removed: daysOf(own), keptClosureDays: daysOf(rows.filter(row => row.closureId !== null)) }
}
