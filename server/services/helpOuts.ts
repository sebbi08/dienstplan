import { and, asc, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { daysInMonth, toIsoDate } from '../../shared/domain/dates'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { HelpCandidateDto, HelperDto, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeHours, employees, entries, facilities, helpOuts, releaseSnapshots } from '../db/schema'
import { ServiceError } from '../lib/errors'

export interface HelpOutInput {
  employeeId: number
  year: number
  month: number
}

function monthBounds(year: number, month: number): { monthStart: IsoDate; monthEnd: IsoDate } {
  return { monthStart: toIsoDate(year, month, 1), monthEnd: toIsoDate(year, month, daysInMonth(year, month)) }
}

/** The month's helpers in facilityId's plan (employees of other facilities), ordered by name. */
export function listHelpers(db: Db, facilityId: number, year: number, month: number): HelperDto[] {
  return db.select({
    helpOutId: helpOuts.id,
    employeeId: employees.id,
    name: employees.name,
    shortName: employees.shortName,
    fromFacilityId: facilities.id,
    fromFacility: facilities.name,
  })
    .from(helpOuts)
    .innerJoin(employees, eq(helpOuts.employeeId, employees.id))
    .innerJoin(facilities, eq(employees.facilityId, facilities.id))
    .where(and(eq(helpOuts.facilityId, facilityId), eq(helpOuts.year, year), eq(helpOuts.month, month)))
    .orderBy(asc(employees.name), asc(employees.id))
    .all()
}

/** Employees of the other facilities who are employed in the month (only their names and home facility). */
function otherFacilitiesStaff(db: Db, facilityId: number, year: number, month: number) {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const rows = db.select({
    employeeId: employees.id, name: employees.name, shortName: employees.shortName, leftOn: employees.leftOn,
    facilityName: facilities.name,
  })
    .from(employees)
    .innerJoin(facilities, eq(employees.facilityId, facilities.id))
    .where(ne(employees.facilityId, facilityId))
    .orderBy(asc(employees.name), asc(employees.id))
    .all()
  const hours = rows.length === 0
    ? []
    : db.select().from(employeeHours).where(inArray(employeeHours.employeeId, rows.map(row => row.employeeId))).all()
  return rows.filter(row => isEmployedInRange({
    hours: hours.filter(h => h.employeeId === row.employeeId)
      .map(h => ({ weeklyMinutes: h.weeklyMinutes, validFrom: h.validFrom, workdays: h.workdays })),
    leftOn: row.leftOn,
  }, monthStart, monthEnd))
}

/** Who facilityId can add as a helper for the month: employed staff of other facilities who are not helpers yet. */
export function helpCandidates(db: Db, facilityId: number, year: number, month: number): HelpCandidateDto[] {
  const helpers = new Set(listHelpers(db, facilityId, year, month).map(helper => helper.employeeId))
  return otherFacilitiesStaff(db, facilityId, year, month)
    .filter(row => !helpers.has(row.employeeId))
    .map(({ employeeId, name, shortName, facilityName }) => ({ employeeId, name, shortName, facilityName }))
}

/** Adds an employee of another facility as a helper of facilityId for the month; returns the help-out id. */
export function addHelpOut(db: Db, facilityId: number, input: HelpOutInput): number {
  const candidate = otherFacilitiesStaff(db, facilityId, input.year, input.month)
    .some(row => row.employeeId === input.employeeId)
  if (!candidate) throw new ServiceError(400, 'employee_not_found')
  return db.transaction((tx) => {
    const existing = tx.select({ id: helpOuts.id }).from(helpOuts).where(and(
      eq(helpOuts.employeeId, input.employeeId), eq(helpOuts.facilityId, facilityId),
      eq(helpOuts.year, input.year), eq(helpOuts.month, input.month),
    )).get()
    if (existing) throw new ServiceError(409, 'help_out_exists')
    return tx.insert(helpOuts)
      .values({ employeeId: input.employeeId, facilityId, year: input.year, month: input.month })
      .returning({ id: helpOuts.id }).get().id
  })
}

/**
 * Removes a helper column of facilityId; refused while the helper still has entries in its plan that month, and while
 * the facility's latest release of the month still shows duties of the helper there (their removal is not released
 * yet: without the column nobody would be told and the published plan would keep them).
 */
export function removeHelpOut(db: Db, facilityId: number, id: number): void {
  db.transaction((tx) => {
    const row = tx.select().from(helpOuts).where(and(eq(helpOuts.id, id), eq(helpOuts.facilityId, facilityId))).get()
    if (!row) throw new ServiceError(404, 'help_out_not_found')
    const { monthStart, monthEnd } = monthBounds(row.year, row.month)
    const planned = tx.select({ id: entries.id }).from(entries).where(and(
      eq(entries.employeeId, row.employeeId), eq(entries.helpFacilityId, facilityId),
      gte(entries.date, monthStart), lte(entries.date, monthEnd),
    )).limit(1).get()
    if (planned) throw new ServiceError(409, 'help_out_has_entries')
    const latest = tx.select({ data: releaseSnapshots.data }).from(releaseSnapshots).where(and(
      eq(releaseSnapshots.facilityId, facilityId), eq(releaseSnapshots.year, row.year), eq(releaseSnapshots.month, row.month),
    )).orderBy(desc(releaseSnapshots.releasedAt), desc(releaseSnapshots.id)).limit(1).get()
    const released = latest ? (JSON.parse(latest.data) as SnapshotData).entries : []
    if (released.some(entry => entry.employeeId === row.employeeId && entry.helpFacilityId === facilityId)) {
      throw new ServiceError(409, 'help_out_released')
    }
    tx.delete(helpOuts).where(eq(helpOuts.id, id)).run()
  })
}

/** Whether the employee is a helper in facilityId's plan in the month of date. */
export function isHelperOn(db: Db, facilityId: number, employeeId: number, date: IsoDate): boolean {
  return db.select({ id: helpOuts.id }).from(helpOuts).where(and(
    eq(helpOuts.employeeId, employeeId), eq(helpOuts.facilityId, facilityId),
    eq(helpOuts.year, Number(date.slice(0, 4))), eq(helpOuts.month, Number(date.slice(5, 7))),
  )).get() !== undefined
}
