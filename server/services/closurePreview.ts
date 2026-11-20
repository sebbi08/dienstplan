import { eq } from 'drizzle-orm'
import { dateRange, parseIsoDate } from '../../shared/domain/dates'
import { countLeaveDays, type HalfOnEves, type LeaveEntitlement } from '../../shared/domain/leave'
import { employmentStart, isWorkday, MONDAY_TO_FRIDAY, type EmploymentInfo } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { ClosureDto, ClosurePreviewYearDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { splitLeave, splitLeaveOf } from './closureBooking'
import { fiveDayWeekLeaveDays } from './closures'
import { facilityHolidayRules } from './holidayRules'
import { yearEntitlement } from './leave'
import { halfLeaveOnEves } from './leaveCounting'
import { loadClosures, loadEmployee } from './queries'

// „Schließzeiten als Urlaub“ as a hint before anything is booked: creating an employee (the typed values) and the
// employee page (the stored ones). Pure computation, always two years: the first from its start day on, the coming
// one whole. The person's days are split by the booking's own function (splitLeaveOf / splitLeave: joiner limit,
// half days on 24 and 31 December), so the hint and the booking cannot drift apart.

/** The typed values of the create form (as POST /api/employees takes them). */
export interface ClosurePreviewInput {
  weeklyMinutes?: number
  workdays?: number
  validFrom: IsoDate
  vacationDays?: number | null
  carriedOverDays?: number | null
}

interface PreviewPerson {
  info: EmploymentInfo
  halfLeaveOnEves: HalfOnEves
  /** Splits the person's closure days into leave and closure days, as the booking does. */
  split: (dates: IsoDate[]) => { vacation: IsoDate[]; closureDays: IsoDate[] }
}

interface YearFacts {
  year: number
  from: IsoDate
  entitlementDays: number | null
  carriedOverDays: number
}

const later = (a: IsoDate, b: IsoDate) => (a > b ? a : b)
const earlier = (a: IsoDate, b: IsoDate) => (a < b ? a : b)

/** The closure days (as leave) of the year in booking order: closure by closure by start date, each day once. */
function vacationDatesOf(closures: ClosureDto[], year: number): IsoDate[] {
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const dates = closures
    .filter(closure => closure.mode === 'vacation' && closure.startDate <= end && closure.endDate >= start)
    .flatMap(closure => dateRange(later(closure.startDate, start), earlier(closure.endDate, end)))
  return [...new Set(dates)]
}

function previewYears(db: Db, facilityId: number, person: PreviewPerson, years: YearFacts[]): ClosurePreviewYearDto[] {
  const closures = loadClosures(db, facilityId)
  const rules = facilityHolidayRules(db, facilityId)
  const halfOnEves = halfLeaveOnEves(db, facilityId)
  return years.map(({ year, from, entitlementDays, carriedOverDays }) => {
    const dates = vacationDatesOf(closures, year)
    // As bookClosure: only the person's working days (employed, no public holiday, a contract weekday), from `from` on.
    const split = person.split(dates.filter(date => date >= from && isWorkday(person.info, date)))
    return {
      year, from,
      // Closures in closure-day mode take no leave: a year with only those counts as one without closures.
      hasClosures: closures.some(closure => closure.mode === 'vacation' && closure.startDate <= `${year}-12-31` && closure.endDate >= `${year}-01-01`),
      facilityDays: fiveDayWeekLeaveDays(dates, rules, halfOnEves),
      personDays: countLeaveDays(split.vacation, person.halfLeaveOnEves),
      closureDaysWithoutLeave: split.closureDays.length,
      entitlementDays, carriedOverDays,
    }
  })
}

/**
 * The preview for a person not created yet, as createEmployee would store and book them: the weekly hours from
 * „gültig ab“, the entitlement (with Resturlaub) recorded for that year and carried into the next, no other leave yet.
 * Working days 0 or beyond the week: 400 workdays_required.
 */
export function previewClosuresForNew(db: Db, facilityId: number, input: ClosurePreviewInput): ClosurePreviewYearDto[] {
  const workdays = input.workdays ?? MONDAY_TO_FRIDAY
  if (workdays <= 0 || workdays > 127) throw new ServiceError(400, 'workdays_required')
  const info: EmploymentInfo = {
    hours: [{ weeklyMinutes: input.weeklyMinutes ?? 0, validFrom: input.validFrom, workdays }],
    leftOn: null,
    holidays: facilityHolidayRules(db, facilityId),
  }
  const year = parseIsoDate(input.validFrom).year
  // createEmployee records an entitlement for the year of „gültig ab“ when either number is given.
  const entitlement: LeaveEntitlement | null = input.vacationDays != null || input.carriedOverDays != null
    ? { days: input.vacationDays ?? 0, carriedOverDays: input.carriedOverDays ?? 0 }
    : null
  const halfOnEves = halfLeaveOnEves(db, facilityId)
  const split = (dates: IsoDate[]) => splitLeaveOf({
    info, halfLeaveOnEves: halfOnEves, entitlement: asked => (asked === year ? entitlement : null), otherLeave: () => [],
  }, dates)
  const days = input.vacationDays ?? null
  return previewYears(db, facilityId, { info, halfLeaveOnEves: halfOnEves, split }, [
    { year, from: input.validFrom, entitlementDays: days, carriedOverDays: input.carriedOverDays ?? 0 },
    { year: year + 1, from: `${year + 1}-01-01`, entitlementDays: days, carriedOverDays: 0 },
  ])
}

/**
 * The preview for an employee of the facility (else 404 employee_not_found) from the stored hours and entitlements:
 * the current year from the later of 1 January, the first weekly hours and the move-in day, and the whole coming year
 * (from the first weekly hours when they start later). The days are split as splitLeave books them now.
 */
export function previewClosuresForEmployee(db: Db, facilityId: number, employeeId: number, today: IsoDate): ClosurePreviewYearDto[] {
  const employee = loadEmployee(db, employeeId)
  if (!employee || employee.facilityId !== facilityId) throw new ServiceError(404, 'employee_not_found')
  const since = db.select({ since: employees.facilitySince }).from(employees).where(eq(employees.id, employeeId)).get()?.since ?? null
  const start = employmentStart(employee.info)
  const fromOf = (year: number) => [start, since].reduce<IsoDate>((day, other) => (other != null ? later(day, other) : day), `${year}-01-01`)
  const year = parseIsoDate(today).year
  const current = yearEntitlement(db, employee, year)
  const coming = yearEntitlement(db, employee, year + 1)
  const person = { info: employee.info, halfLeaveOnEves: employee.halfLeaveOnEves, split: (dates: IsoDate[]) => splitLeave(db, employee, dates) }
  return previewYears(db, facilityId, person, [
    { year, from: fromOf(year), entitlementDays: current?.days ?? null, carriedOverDays: current?.carriedOverDays ?? 0 },
    { year: year + 1, from: fromOf(year + 1), entitlementDays: coming?.days ?? null, carriedOverDays: 0 },
  ])
}
