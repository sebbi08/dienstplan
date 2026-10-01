import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { describeEntry } from '../../shared/domain/describe'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { CodeKey, IsoDate } from '../../shared/domain/types'
import type { ClosureDto, CodeDto, ColorKey, CoverageRuleDto, EntryDto, TemplateDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, coverageRules, employeeHours, employees, entries, shiftTemplates } from '../db/schema'

export interface EntryFilter {
  from?: IsoDate
  to?: IsoDate
  employeeId?: number
  closureId?: number
  codeKey?: CodeKey
}

export interface EmployeeRecord {
  id: number
  name: string
  shortName: string
  sortOrder: number
  leftOn: IsoDate | null
  info: EmploymentInfo
}

export function loadEntries(db: Db, filter: EntryFilter = {}): EntryDto[] {
  const rows = db.select({ entry: entries, code: absenceCodes, template: shiftTemplates })
    .from(entries)
    .leftJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .leftJoin(shiftTemplates, eq(entries.shiftTemplateId, shiftTemplates.id))
    .where(and(
      filter.from ? gte(entries.date, filter.from) : undefined,
      filter.to ? lte(entries.date, filter.to) : undefined,
      filter.employeeId !== undefined ? eq(entries.employeeId, filter.employeeId) : undefined,
      filter.closureId !== undefined ? eq(entries.closureId, filter.closureId) : undefined,
      filter.codeKey ? eq(absenceCodes.key, filter.codeKey) : undefined,
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

export function loadEmployees(db: Db): EmployeeRecord[] {
  const hours = db.select().from(employeeHours).orderBy(asc(employeeHours.validFrom)).all()
  return db.select().from(employees).orderBy(asc(employees.sortOrder), asc(employees.name)).all()
    .map(row => ({
      ...row,
      info: {
        hours: hours.filter(h => h.employeeId === row.id).map(h => ({ weeklyMinutes: h.weeklyMinutes, validFrom: h.validFrom })),
        leftOn: row.leftOn,
      },
    }))
}

export function loadClosures(db: Db): ClosureDto[] {
  return db.select().from(closures).orderBy(asc(closures.startDate)).all()
}

export function closureOn(list: ClosureDto[], date: IsoDate): ClosureDto | null {
  return list.find(closure => closure.startDate <= date && date <= closure.endDate) ?? null
}

export function loadTemplates(db: Db): TemplateDto[] {
  return db.select().from(shiftTemplates).orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.start)).all()
}

export function loadCodes(db: Db): CodeDto[] {
  return db.select().from(absenceCodes).orderBy(asc(absenceCodes.sortOrder)).all()
    .map(code => ({ ...code, key: code.key as CodeKey, color: code.color as ColorKey }))
}

export function loadCoverageRules(db: Db, activeOnly = true): CoverageRuleDto[] {
  return db.select().from(coverageRules)
    .where(activeOnly ? eq(coverageRules.active, true) : undefined)
    .orderBy(asc(coverageRules.start)).all()
}
