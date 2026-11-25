import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import { countLeaveDays, groupLeaveRanges, leaveAccount, type LeaveDayRule, type LeaveEntitlement } from '../../shared/domain/leave'
import { forfeitDateOf } from '../../shared/domain/leaveForfeit'
import { cutEntitlement, leaveCutMonths, leaveProtection, type LeaveProtection } from '../../shared/domain/parentalLeave'
import { isEmployedInRange, isLeaveWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { ClosureLeaveDto, LeaveAccountDto, LeaveEntryKind, LeaveEntryRange } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, entries, facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { entitlementFor, firstEntitlementYear, leaveExtraDaysByYear, leaveExtraDaysOf } from './entitlements'
import { closureColumns, loadClosures, loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

export interface YearEntitlement extends LeaveEntitlement {
  /** The one-off extra days of the year („Zusatztag nur für dieses Jahr“); never carried into a later entitlement. */
  extraDays: number
  /** The year the entitlement (days) was recorded for; earlier than the year when it was carried into it. */
  fromYear: number
  /** True when the carry-over is what was left of the year before (every year after the first recorded one). */
  carriedAutomatically: boolean
  /** Days of the recorded entitlement cut for Elternzeit (§ 17 Abs. 1 BEEG, only when declared); `days` is already cut. */
  parentalLeaveCut: number
}

/**
 * The entitlement of the year after the Elternzeit cut: 1/12 per full calendar month of a full Elternzeit for which the
 * employer declared the cut (§ 17 Abs. 1 BEEG; shared/domain/parentalLeave.ts cutEntitlement rounds what is left).
 */
function cutFor(employee: EmployeeRecord, days: number, year: number): { days: number; cut: number } {
  return cutEntitlement(days, leaveCutMonths(employee.info.parentalLeaves, year))
}

/**
 * Only the employee's own working days count as leave days, and not the days of Langzeitkrank or Kur/Reha (a long
 * absence: sick days, § 9 BUrlG – an Urlaub entry there uses no leave, as if „Krank“ had replaced it).
 */
function leaveDayRule(employee: EmployeeRecord): LeaveDayRule {
  return date => isLeaveWorkday(employee.info, date)
}

/**
 * Entitlement and carry-over of an employee in a year. The days are the last ones recorded up to that year. The first
 * recorded year keeps the carry-over entered for it; every later year carries over what was left of the year before,
 * a minus too. The one-off extra days of a year („Zusatztag nur für dieses Jahr“) count only in that year: they raise
 * what is available there, so what is left of them carries over like the rest. A declared Elternzeit cut lowers the
 * days of each year it falls in (cutFor). Null before the first recorded year.
 */
export function yearEntitlement(db: Db, employee: EmployeeRecord, year: number): YearEntitlement | null {
  const first = firstEntitlementYear(db, employee.id)
  if (first === null || year < first) return null
  const isLeaveDay = leaveDayRule(employee)
  const vacationDates = loadEntries(db, { employeeId: employee.id, from: `${first}-01-01`, to: `${year - 1}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date)
  const extraDays = leaveExtraDaysByYear(db, employee.id)
  let carriedOverDays = entitlementFor(db, employee.id, first)!.carriedOverDays
  for (let current = first; current < year; current++) {
    const days = cutFor(employee, entitlementFor(db, employee.id, current)!.days, current).days
    // "available" does not depend on the day it is looked at, so any date will do.
    carriedOverDays = leaveAccount(
      { days, carriedOverDays, extraDays: extraDays.get(current) ?? 0 }, vacationDates, current, `${current}-01-01`, isLeaveDay,
      employee.halfLeaveOnEves,
    ).available
  }
  const recorded = entitlementFor(db, employee.id, year)!
  const cut = cutFor(employee, recorded.days, year)
  return {
    days: cut.days, parentalLeaveCut: cut.cut, extraDays: extraDays.get(year) ?? 0, carriedOverDays, fromYear: recorded.fromYear,
    carriedAutomatically: year > first,
  }
}

/**
 * The leave account of one employee (whatever facility they belong to; callers check access). The reasons of
 * Sonderurlaub only with `withReasons`: for Leitung and Träger (employees.sickness) and the employee themselves.
 */
export function getLeaveAccount(db: Db, employeeId: number, year: number, today: IsoDate, withReasons = false): LeaveAccountDto {
  const employee = loadEmployee(db, employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const isLeaveDay = leaveDayRule(employee)
  const vacationDates = loadEntries(db, { employeeId, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date)
  const entitlement = yearEntitlement(db, employee, year)
  return {
    employeeId, name: employee.name, year,
    account: leaveAccount(entitlement, vacationDates, year, today, isLeaveDay, employee.halfLeaveOnEves),
    inheritedFrom: entitlement && entitlement.fromYear !== year ? entitlement.fromYear : null,
    hasEntitlement: entitlement !== null,
    carriedAutomatically: entitlement?.carriedAutomatically ?? false,
    ranges: groupLeaveRanges(vacationDates, isLeaveDay, employee.halfLeaveOnEves),
    entryRanges: entryRanges(db, employee, year, withReasons),
    closures: closureLeave(db, employee, year),
    // Without an entitlement the account counts no extra days, so none are listed either.
    extraDays: entitlement ? leaveExtraDaysOf(db, employeeId, year).map(({ days, reason }) => ({ days, reason })) : [],
    parentalLeaveCut: entitlement?.parentalLeaveCut ?? 0,
    parentalLeaveProtectedUntil: entitlement ? protectedUntil(db, employee, year) : null,
  }
}

/**
 * The last day the remaining leave of the year can be taken when an Elternzeit keeps it from lapsing on the facility's
 * forfeiture day (§ 17 Abs. 2 BEEG; null = it lapses as usual). The notice on remaining leave uses it as that year's
 * forfeiture day (leaveForfeit.ts).
 */
export function protectedUntil(db: Db, employee: EmployeeRecord, year: number): IsoDate | null {
  return leaveProtectionOf(db, employee, year)?.until ?? null
}

/** The protection of the year's remaining leave by an Elternzeit with its return day (null = none; see protectedUntil). */
export function leaveProtectionOf(db: Db, employee: EmployeeRecord, year: number): LeaveProtection | null {
  if (!(employee.info.parentalLeaves ?? []).length) return null
  const setting = db.select({ day: facilities.leaveForfeitDay, month: facilities.leaveForfeitMonth }).from(facilities)
    .where(eq(facilities.id, employee.facilityId)).get()
  return setting ? leaveProtection(employee.info.parentalLeaves, year, forfeitDateOf(year, setting)) : null
}

const LEAVE_ENTRY_KINDS: LeaveEntryKind[] = ['vacation', 'special_leave', 'overtime_off']

/**
 * The person's own Urlaub, Sonderurlaub and Überstundenfrei entries of the year as periods of working days (a period
 * bridges days off, see groupLeaveRanges), by start date. The leave a closure booked is left out: it belongs to the
 * closure (closureLeave) and is not removed period by period. Only Urlaub counts 24/31 December as half a day.
 * Sonderurlaub with `withReasons` is split by its reason (key and text), each period with it.
 */
function entryRanges(db: Db, employee: EmployeeRecord, year: number, withReasons: boolean): LeaveEntryRange[] {
  const rows = db.select({
    date: entries.date, key: absenceCodes.key, reason: entries.specialLeaveReason, text: entries.specialLeaveText,
  })
    .from(entries).innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .where(and(
      eq(entries.employeeId, employee.id), isNull(entries.closureId), inArray(absenceCodes.key, LEAVE_ENTRY_KINDS),
      gte(entries.date, `${year}-01-01`), lte(entries.date, `${year}-12-31`),
    )).all()
  const isLeaveDay = leaveDayRule(employee)
  type Group = { kind: LeaveEntryKind; rows: typeof rows; reason: LeaveEntryRange['reason'] }
  const groups = LEAVE_ENTRY_KINDS.flatMap((kind): Group[] => {
    const ofKind = rows.filter(row => row.key === kind)
    if (kind !== 'special_leave' || !withReasons) return [{ kind, rows: ofKind, reason: undefined }]
    const byReason = new Map<string, { key: string | null; text: string | null }>()
    for (const row of ofKind) byReason.set(JSON.stringify([row.reason, row.text]), { key: row.reason, text: row.text })
    return [...byReason].map(([signature, reason]) => ({
      kind, rows: ofKind.filter(row => JSON.stringify([row.reason, row.text]) === signature), reason,
    }))
  })
  return groups
    .flatMap(({ kind, rows: ofGroup, reason }): LeaveEntryRange[] => groupLeaveRanges(
      ofGroup.map(row => row.date), isLeaveDay, kind === 'vacation' && employee.halfLeaveOnEves,
    ).map(range => ({ kind, ...range, ...(reason ? { reason } : {}) })))
    .sort((a, b) => a.from.localeCompare(b.from))
}

/**
 * What each closure (as leave) took from the employee's leave in the year: the home facility's ones touching the year
 * while the person is employed, also with nothing taken, and any other one still linked to the person's entries (a
 * former facility). Counted are the
 * entries still linked to the closure, so a day changed in the plan no longer counts.
 */
function closureLeave(db: Db, employee: EmployeeRecord, year: number): ClosureLeaveDto[] {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const linked = db.select({ closureId: entries.closureId, date: entries.date, codeKey: absenceCodes.key })
    .from(entries).innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .where(and(eq(entries.employeeId, employee.id), isNotNull(entries.closureId), gte(entries.date, from), lte(entries.date, to)))
    .all()
  const ids = new Set([
    ...loadClosures(db, employee.facilityId)
      .filter(closure => closure.startDate <= to && closure.endDate >= from && isEmployedInRange(employee.info, closure.startDate, closure.endDate))
      .map(closure => closure.id),
    ...linked.map(row => row.closureId!),
  ])
  if (!ids.size) return []
  const isLeaveDay = leaveDayRule(employee)
  return db.select(closureColumns).from(closures)
    .where(and(inArray(closures.id, [...ids]), eq(closures.mode, 'vacation'))).orderBy(asc(closures.startDate)).all()
    .map((closure) => {
      const own = linked.filter(row => row.closureId === closure.id)
      const dates = (key: string) => [...new Set(own.filter(row => row.codeKey === key).map(row => row.date))].filter(isLeaveDay)
      return {
        closureId: closure.id, label: closure.label, startDate: closure.startDate, endDate: closure.endDate,
        days: countLeaveDays(dates('vacation'), employee.halfLeaveOnEves), closureDays: dates('closure_day').length,
      }
    })
}

/** Leave accounts of the facility's staff employed in the year; the Sonderurlaub reasons only `withReasons`. */
export function getLeaveOverview(db: Db, facilityId: number, year: number, today: IsoDate, withReasons = false): LeaveAccountDto[] {
  return loadEmployees(db, facilityId)
    .filter(employee => isEmployedInRange(employee.info, `${year}-01-01`, `${year}-12-31`))
    .map(employee => getLeaveAccount(db, employee.id, year, today, withReasons))
}
