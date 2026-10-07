import { and, asc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm'
import { describeEntry } from '../../shared/domain/describe'
import type { BreakMode, StampChannel } from '../../shared/domain/stamping'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { CodeKey, IsoDate } from '../../shared/domain/types'
import type { ClosureDto, CodeDto, ColorKey, CoverageRuleDto, EntryDto, TemplateDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, coverageRules, employeeHours, employees, entries, shiftTemplates } from '../db/schema'

export interface EntryFilter {
  from?: IsoDate
  to?: IsoDate
  employeeId?: number
  /** Only entries of these employees. */
  employeeIds?: number[]
  closureId?: number
  codeKey?: CodeKey
  /** Only entries of employees whose home facility this is. */
  facilityId?: number
}

export interface EmployeeRecord {
  id: number
  facilityId: number
  name: string
  shortName: string
  sortOrder: number
  leftOn: IsoDate | null
  info: EmploymentInfo
  // Contract data (see shared/domain/tvoed.ts); who may see it is decided in the employees service.
  personnelNumber: string | null
  employedSince: IsoDate | null
  jobKey: string | null
  jobOther: string | null
  payGroup: string | null
  payLevel: number | null
  // Time tracking options set by the Leitung (see shared/domain/stamping.ts).
  stampVia: StampChannel
  breakMode: BreakMode
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
      filter.facilityId !== undefined ? eq(employees.facilityId, filter.facilityId) : undefined,
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

function loadEmployeeRecords(db: Db, where: SQL | undefined): EmployeeRecord[] {
  const hours = db.select().from(employeeHours).orderBy(asc(employeeHours.validFrom)).all()
  return db.select().from(employees)
    .where(where)
    .orderBy(asc(employees.sortOrder), asc(employees.name)).all()
    .map(row => ({
      ...row,
      info: {
        hours: hours.filter(h => h.employeeId === row.id).map(h => ({ weeklyMinutes: h.weeklyMinutes, validFrom: h.validFrom, workdays: h.workdays })),
        leftOn: row.leftOn,
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
  return db.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, facilityId)).orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.start)).all()
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
 * staff, from the day each one moved in. Cells of people who moved away, and cells from before someone moved in
 * (planned by the other facility), are left alone.
 */
export function ownCellFilter(db: Db, facilityId: number): (employeeId: number, date: IsoDate) => boolean {
  const since = new Map(db.select({ id: employees.id, since: employees.facilitySince }).from(employees)
    .where(eq(employees.facilityId, facilityId)).all().map(row => [row.id, row.since]))
  return (employeeId, date) => {
    if (!since.has(employeeId)) return false
    const from = since.get(employeeId)
    return from == null || date >= from
  }
}
