import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { groupLeaveRanges } from '../../shared/domain/leave'
import { isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type {
  LeaveEntryKind, LeaveRequestDto, LeaveYearListDto, LeaveYearListFilter, LeaveYearRangeDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, entries } from '../db/schema'
import { getLeaveOverview } from './leave'
import { listFacilityRequests, mayDecide, requirePlanner } from './leaveRequests'
import { loadEmployees, type EmployeeRecord } from './queries'

const LEAVE_KINDS: LeaveEntryKind[] = ['vacation', 'special_leave', 'overtime_off']
/** The code an approved request of the kind wrote into the plan (Sonderurlaub is never requested). */
const REQUEST_KIND: Record<LeaveEntryKind, LeaveRequestDto['kind'] | null> = {
  vacation: 'vacation', overtime_off: 'overtime_off', special_leave: null,
}

/**
 * The approved request a leave day of the kind belongs to, by date alone: of the requests whose range contains the
 * day, the one made last (request order: start date, then id; `requests` come in that order). So overlapping requests
 * each keep their own days instead of the first one taking all. Null: entered directly.
 * The plan does not remember who wrote a single day, so a day entered by hand inside an approved request's range (e.g.
 * deleted and entered again) counts as from the request (accepted; see BETRIEB.md „Alle Anträge und Urlaube“).
 */
export function requestOfDay(requests: Pick<LeaveRequestDto, 'startDate' | 'endDate'>[], date: IsoDate): number | null {
  for (let index = requests.length - 1; index >= 0; index--) {
    const request = requests[index]!
    if (request.startDate <= date && date <= request.endDate) return index
  }
  return null
}

/**
 * The person's own leave days of the year (Urlaub, Sonderurlaub, ÜF, not booked by a closure) as periods, split by
 * origin (requestOfDay): a day inside an approved request of the same kind belongs to that request, every other day
 * was entered directly. Periods are grouped per kind and origin (groupLeaveRanges: bridging days off, 24/31 December
 * maybe half for Urlaub), so a request and leave entered right after it stay two periods.
 */
function entryPeriods(
  employee: EmployeeRecord, rows: { date: IsoDate; key: string }[], approved: LeaveRequestDto[],
): LeaveYearRangeDto[] {
  const isLeaveDay = (date: IsoDate) => isWorkday(employee.info, date)
  return LEAVE_KINDS.flatMap((kind) => {
    const requests = approved.filter(request => request.kind === REQUEST_KIND[kind])
    const byOrigin = new Map<LeaveRequestDto | null, IsoDate[]>()
    for (const row of rows) {
      if (row.key !== kind) continue
      const index = requestOfDay(requests, row.date)
      const request = index === null ? null : requests[index]!
      byOrigin.set(request, [...(byOrigin.get(request) ?? []), row.date])
    }
    return [...byOrigin].flatMap(([request, dates]) =>
      groupLeaveRanges(dates, isLeaveDay, kind === 'vacation' && employee.halfLeaveOnEves).map(range => ({
        kind, ...range, origin: request ? 'request' as const : 'direct' as const,
        requestId: request?.id ?? null, decidedAt: request?.decidedAt ?? null, closureLabel: null,
      })))
  })
}

/** Whether a period passes the kind and status filters ('approved': from a request, 'direct': entered directly). */
function rangeMatches(range: LeaveYearRangeDto, filter: LeaveYearListFilter): boolean {
  if (filter.kind && range.kind !== filter.kind) return false
  if (!filter.status) return true
  if (filter.status === 'approved') return range.origin === 'request'
  if (filter.status === 'direct') return range.origin === 'direct'
  return false
}

/**
 * „Alle Anträge und Urlaube“ (Urlaubsplanung, planners only as the planning page): every request touching the year
 * with status, decision and reason, and per person the leave periods of the year with their origin and the summary of
 * the leave account. Filtered here (person, kind, status incl. „direkt eingetragen“), so page and print view agree.
 */
export function getLeaveYearList(
  db: Db, user: SessionUser, facilityId: number, year: number, filter: LeaveYearListFilter, today: IsoDate,
): LeaveYearListDto {
  requirePlanner(db, user, facilityId)
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const allRequests = listFacilityRequests(db, facilityId, from, to)
  const accounts = getLeaveOverview(db, facilityId, year, today)
  const staff = new Map(loadEmployees(db, facilityId).map(employee => [employee.id, employee]))
  const rows = accounts.length === 0
    ? []
    : db.select({ employeeId: entries.employeeId, date: entries.date, key: absenceCodes.key })
        .from(entries).innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
        .where(and(
          inArray(entries.employeeId, accounts.map(account => account.employeeId)), isNull(entries.closureId),
          inArray(absenceCodes.key, LEAVE_KINDS), gte(entries.date, from), lte(entries.date, to),
        )).all()

  const people = accounts
    .filter(account => !filter.employeeId || account.employeeId === filter.employeeId)
    .map((account) => {
      const employee = staff.get(account.employeeId)!
      const approved = allRequests.filter(request => request.employeeId === account.employeeId && request.status === 'approved')
      // The closure's leave days in this year only (the account counts its entries of the year), the period clipped to it.
      const closures: LeaveYearRangeDto[] = account.closures.filter(closure => closure.days > 0).map(closure => ({
        kind: 'vacation', from: closure.startDate < from ? from : closure.startDate, to: closure.endDate > to ? to : closure.endDate,
        days: closure.days, origin: 'closure', requestId: null, decidedAt: null, closureLabel: closure.label,
      }))
      const ranges = [...entryPeriods(employee, rows.filter(row => row.employeeId === account.employeeId), approved), ...closures]
        .filter(range => rangeMatches(range, filter))
        .sort((a, b) => a.from.localeCompare(b.from))
      return { employeeId: account.employeeId, name: account.name, account: account.account, hasEntitlement: account.hasEntitlement, ranges }
    })
    .filter(person => (!filter.kind && !filter.status) || person.ranges.length > 0)

  const requests = allRequests
    .filter(request => (!filter.employeeId || request.employeeId === filter.employeeId)
      && (!filter.kind || request.kind === filter.kind)
      && (!filter.status || request.status === filter.status))
    .map(request => ({ ...request, canDecide: mayDecide(user, request) }))

  return {
    year,
    employees: accounts.map(account => ({ id: account.employeeId, name: account.name })),
    requests,
    people,
  }
}
