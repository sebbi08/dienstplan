import { and, asc, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm'
import { describeEntry } from '../../shared/domain/describe'
import type { Qualification } from '../../shared/domain/staffing/types'
import type { BreakMode, StampChannel } from '../../shared/domain/stamping'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { CodeKey, IsoDate } from '../../shared/domain/types'
import type { ClosureDto, CodeDto, ColorKey, CoverageRuleDto, EntryDto, TemplateDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, coverageRules, employeeHours, employees, entries, facilities, helpOuts, shiftTemplates } from '../db/schema'

export interface EntryFilter {
  from?: IsoDate
  to?: IsoDate
  employeeId?: number
  /** Only entries of these employees. */
  employeeIds?: number[]
  closureId?: number
  codeKey?: CodeKey
  /**
   * Only entries of employees whose home facility this is, help-outs elsewhere included: everything about the
   * person's account (balances, week totals, leave, sick days, calendar, time tracking).
   */
  homeFacilityId?: number
  /**
   * Only the plan of this facility: its home staff's entries that are no help-out elsewhere, plus the help-out entries
   * planned in it (plan cells, snapshots, coverage, week templates, notifications, revert).
   */
  planFacilityId?: number
}

export interface EmployeeRecord {
  id: number
  facilityId: number
  name: string
  shortName: string
  sortOrder: number
  leftOn: IsoDate | null
  /** The home group (null = Springer, or the facility has no groups). */
  groupId: number | null
  info: EmploymentInfo
  // Contract data (see shared/domain/tvoed.ts); who may see it is decided in the employees service.
  personnelNumber: string | null
  employedSince: IsoDate | null
  jobKey: string | null
  jobOther: string | null
  payGroup: string | null
  payLevel: number | null
  /** „befristet bis“ (null = unbefristet). */
  fixedTermUntil: IsoDate | null
  // Time tracking options set by the Leitung (see shared/domain/stamping.ts).
  stampVia: StampChannel
  breakMode: BreakMode
  /** Birthday as `MM-DD` without a year (null = not given). */
  birthday: string | null
  /** Staffing ratio: qualification (null = not entered) and counting share in percent (null = the state's default). */
  qualification: Qualification | null
  staffingShare: number | null
  /** The home facility counts a leave day on 24 or 31 December as half a day (see leaveDayWeight). */
  halfLeaveOnEves: boolean
}

/** Entries in the plan of facilityId (see `EntryFilter.planFacilityId`); needs `employees` joined on the entry's employee. */
export function inPlanOf(facilityId: number): SQL {
  return or(
    eq(entries.helpFacilityId, facilityId),
    and(isNull(entries.helpFacilityId), eq(employees.facilityId, facilityId)),
  )!
}

export function loadEntries(db: Db, filter: EntryFilter = {}): EntryDto[] {
  const rows = db.select({ entry: entries, code: absenceCodes, template: shiftTemplates })
    .from(entries)
    .innerJoin(employees, eq(entries.employeeId, employees.id))
    .leftJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .leftJoin(shiftTemplates, eq(entries.shiftTemplateId, shiftTemplates.id))
    .where(and(
      filter.from ? gte(entries.date, filter.from) : undefined,
      filter.to ? lte(entries.date, filter.to) : undefined,
      filter.employeeId !== undefined ? eq(entries.employeeId, filter.employeeId) : undefined,
      filter.employeeIds !== undefined ? inArray(entries.employeeId, filter.employeeIds) : undefined,
      filter.closureId !== undefined ? eq(entries.closureId, filter.closureId) : undefined,
      filter.codeKey ? eq(absenceCodes.key, filter.codeKey) : undefined,
      filter.homeFacilityId !== undefined ? eq(employees.facilityId, filter.homeFacilityId) : undefined,
      filter.planFacilityId !== undefined ? inPlanOf(filter.planFacilityId) : undefined,
    ))
    .orderBy(asc(entries.date), asc(entries.start), asc(entries.id))
    .all()

  return rows.map(({ entry, code, template }): EntryDto => ({
    id: entry.id,
    employeeId: entry.employeeId,
    date: entry.date,
    kind: entry.kind,
    templateId: entry.shiftTemplateId,
    codeId: entry.absenceCodeId,
    codeKey: (code?.key ?? null) as CodeKey | null,
    creditMode: entry.kind === 'code' ? (code?.creditMode ?? 'none') : 'timed',
    start: entry.start,
    end: entry.end,
    breakStart: entry.breakStart,
    breakEnd: entry.breakEnd,
    countsAsStaff: entry.countsAsStaff,
    note: entry.note,
    helpFacilityId: entry.helpFacilityId,
    groupId: entry.groupId,
    label: describeEntry(entry, code?.label ?? null),
    shortLabel: template?.shortLabel || null,
    color: entry.kind === 'code'
      ? (code?.color ?? 'neutral') as ColorKey
      : entry.kind === 'break' ? 'red' : entry.countsAsStaff ? 'neutral' : 'violet',
  }))
}

export function groupByEmployee(list: EntryDto[]): Map<number, EntryDto[]> {
  const map = new Map<number, EntryDto[]>()
  for (const entry of list) {
    const bucket = map.get(entry.employeeId) ?? []
    bucket.push(entry)
    map.set(entry.employeeId, bucket)
  }
  return map
}

/** Employees with their contract hours and the public-holiday rules of their home facility. */
function loadEmployeeRecords(db: Db, where: SQL | undefined): EmployeeRecord[] {
  const hours = db.select().from(employeeHours).orderBy(asc(employeeHours.validFrom)).all()
  return db.select({
    row: employees, state: facilities.state, assumptionDay: facilities.assumptionDay,
    halfLeaveOnEves: facilities.christmasEveHalfLeave,
  })
    .from(employees)
    .innerJoin(facilities, eq(employees.facilityId, facilities.id))
    .where(where)
    .orderBy(asc(employees.sortOrder), asc(employees.name)).all()
    .map(({ row, state, assumptionDay, halfLeaveOnEves }) => ({
      ...row,
      halfLeaveOnEves,
      info: {
        hours: hours.filter(h => h.employeeId === row.id).map(h => ({ weeklyMinutes: h.weeklyMinutes, validFrom: h.validFrom, workdays: h.workdays })),
        leftOn: row.leftOn,
        holidays: { state, assumptionDay },
      },
    }))
}

/** The employees whose home facility is facilityId. There is deliberately no way to list all facilities' employees. */
export function loadEmployees(db: Db, facilityId: number): EmployeeRecord[] {
  return loadEmployeeRecords(db, eq(employees.facilityId, facilityId))
}

/** One employee by id, whatever facility they belong to (callers check access; the record carries facilityId). */
export function loadEmployee(db: Db, id: number): EmployeeRecord | undefined {
  return loadEmployeeRecords(db, eq(employees.id, id))[0]
}

export const closureColumns = {
  id: closures.id, startDate: closures.startDate, endDate: closures.endDate, label: closures.label, mode: closures.mode,
}

export function loadClosures(db: Db, facilityId: number): ClosureDto[] {
  return db.select(closureColumns).from(closures).where(eq(closures.facilityId, facilityId))
    .orderBy(asc(closures.startDate)).all()
}

export function closureOn(list: ClosureDto[], date: IsoDate): ClosureDto | null {
  return list.find(closure => closure.startDate <= date && date <= closure.endDate) ?? null
}

export function loadTemplates(db: Db, facilityId: number): TemplateDto[] {
  // By start, then end, then label (German collation); the stored sortOrder is no longer used.
  return db.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, facilityId)).all()
    .sort((a, b) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label, 'de') || a.id - b.id)
}

export function loadCodes(db: Db): CodeDto[] {
  return db.select().from(absenceCodes).orderBy(asc(absenceCodes.sortOrder)).all()
    .map(code => ({ ...code, key: code.key as CodeKey, color: code.color as ColorKey }))
}

export function loadCoverageRules(db: Db, facilityId: number, activeOnly = true): CoverageRuleDto[] {
  return db.select().from(coverageRules)
    .where(and(eq(coverageRules.facilityId, facilityId), activeOnly ? eq(coverageRules.active, true) : undefined))
    .orderBy(asc(coverageRules.start)).all()
}

/**
 * Which plan cells are the facility's own when its draft is compared with (or reset to) a release: those of its current
 * staff, from the day each one moved in, and those of its helpers in the months they help out here. Cells of people who
 * moved away, and cells from before someone moved in (planned by the other facility), are left alone.
 */
export function ownCellFilter(db: Db, facilityId: number): (employeeId: number, date: IsoDate) => boolean {
  const since = new Map(db.select({ id: employees.id, since: employees.facilitySince }).from(employees)
    .where(eq(employees.facilityId, facilityId)).all().map(row => [row.id, row.since]))
  const helperMonths = new Set(db.select({ employeeId: helpOuts.employeeId, year: helpOuts.year, month: helpOuts.month })
    .from(helpOuts).where(eq(helpOuts.facilityId, facilityId)).all()
    .map(row => helperMonthKey(row.employeeId, row.year, row.month)))
  return (employeeId, date) => {
    if (helperMonths.has(helperMonthKey(employeeId, Number(date.slice(0, 4)), Number(date.slice(5, 7))))) return true
    if (!since.has(employeeId)) return false
    const from = since.get(employeeId)
    return from == null || date >= from
  }
}

function helperMonthKey(employeeId: number, year: number, month: number): string {
  return `${employeeId}:${year}-${month}`
}
