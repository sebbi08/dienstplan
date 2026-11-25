import { createHash } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { addDays, isValidIsoDate, weekday } from '../../shared/domain/dates'
import { describeEntry } from '../../shared/domain/describe'
import { isHolidayIn } from '../../shared/domain/holidays'
import { isProtectedCode, PROTECTED_CODE_KEYS } from '../../shared/domain/maternity'
import { longAbsenceOn } from '../../shared/domain/longAbsence'
import { type EmploymentInfo, isEmployedOn, isWorkday, MONDAY_TO_FRIDAY } from '../../shared/domain/targets'
import type { TimeSpan } from '../../shared/domain/time'
import type { CodeKey, DomainEntry, IsoDate } from '../../shared/domain/types'
import { isTargetGapCode, TARGET_GAP_CODES } from '../../shared/domain/warnings'
import {
  isTemplateWeekend, planEntryColor, TEMPLATE_INFO_MAX, TEMPLATE_WEEKDAYS, templateCellConflict,
} from '../../shared/domain/weekTemplates'
import type {
  ColorKey, SessionUser, WeekTemplateApplyResult, WeekTemplateCoverageDto, WeekTemplateDetailDto, WeekTemplateDto,
  WeekTemplateEntryDto, WeekTemplateInfo, WeekTemplateInput, WeekTemplateStaffDto, WeekTemplateUseDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  absenceCodes, dayNotes, employees, entries, shiftTemplates, weekTemplateEntries, weekTemplateInfos, weekTemplateMarks, weekTemplates,
  weekTemplateUses,
} from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { dayConflict, describeCellAt, resolveEntry, setDayNote } from './entries'
import { assertGroup, groupNames } from './groups'
import { loadHoursContext } from './openingHours'
import { closureOn, loadClosures, loadCodes, loadCoverageRules, loadEmployees, loadEntries } from './queries'

/** A template covers Monday to Sunday. */
const WEEKDAYS = TEMPLATE_WEEKDAYS

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'name_required')
  return trimmed
}

function requireMonday(weekStart: IsoDate): void {
  if (!isValidIsoDate(weekStart) || weekday(weekStart) !== 0) throw new ServiceError(400, 'not_a_monday')
}

/** The facility's template; another facility's id gives week_template_not_found. */
function requireTemplate(db: Db, facilityId: number, id: number) {
  const template = db.select().from(weekTemplates)
    .where(and(eq(weekTemplates.id, id), eq(weekTemplates.facilityId, facilityId))).get()
  if (!template) throw new ServiceError(404, 'week_template_not_found')
  return template
}

type SavedTimes = Pick<typeof weekTemplateEntries.$inferSelect, 'start' | 'end' | 'breakStart' | 'breakEnd'>

/** True when a saved shift still has the current times of its service (Dienst), so its short label still fits. */
function isCurrent(entry: SavedTimes, shift: typeof shiftTemplates.$inferSelect | null | undefined): boolean {
  return !!shift && shift.start === entry.start && shift.end === entry.end
    && shift.breakStart === entry.breakStart && shift.breakEnd === entry.breakEnd
}

/**
 * Mutterschutz and Beschäftigungsverbot (health data, server/lib/protectedCodes.ts) never belong in a template: templates
 * are for regular duties. Saving a week and the editor never take them; a template row holding one anyway (e.g. from an
 * old database) is neither shown nor written into the plan.
 */
function protectedCodeIds(db: Db): Set<number> {
  return new Set(db.select({ id: absenceCodes.id }).from(absenceCodes).where(inArray(absenceCodes.key, [...PROTECTED_CODE_KEYS])).all()
    .map(row => row.id))
}

/** The template's entries with their code and service (Dienst), by weekday and start; never a protected code. */
function templateRows(db: Db, templateId: number) {
  return templateRowsWithProtected(db, templateId).filter(row => !isProtectedCode(row.code?.key as CodeKey | undefined))
}

function templateRowsWithProtected(db: Db, templateId: number) {
  return db.select({ entry: weekTemplateEntries, code: absenceCodes, shift: shiftTemplates })
    .from(weekTemplateEntries)
    .leftJoin(absenceCodes, eq(weekTemplateEntries.absenceCodeId, absenceCodes.id))
    .leftJoin(shiftTemplates, eq(weekTemplateEntries.shiftTemplateId, shiftTemplates.id))
    .where(eq(weekTemplateEntries.weekTemplateId, templateId))
    .orderBy(asc(weekTemplateEntries.weekday), asc(weekTemplateEntries.start), asc(weekTemplateEntries.id))
    .all()
}

function toDto(db: Db, template: typeof weekTemplates.$inferSelect): WeekTemplateDto {
  const rows = templateRows(db, template.id)
  const preview = loadEmployees(db, template.facilityId).flatMap((employee) => {
    const own = rows.filter(row => row.entry.employeeId === employee.id)
    if (own.length === 0) return []
    const days = Array.from({ length: WEEKDAYS }, (_, day) => own.filter(row => row.entry.weekday === day)
      .map(({ entry, code, shift }) => ((entry.kind === 'shift' && isCurrent(entry, shift) && shift?.shortLabel) || describeEntry(entry, code?.label ?? null, code?.creditMode ?? null))
        + (entry.homeOffice ? ' (Homeoffice)' : ''))
      .join(' + '))
    return [{ employeeId: employee.id, name: employee.name, days }]
  })
  return { id: template.id, name: template.name, groupId: template.groupId, updatedAt: template.updatedAt, rows: preview }
}

export function listWeekTemplates(db: Db, facilityId: number): WeekTemplateDto[] {
  return db.select().from(weekTemplates).where(eq(weekTemplates.facilityId, facilityId)).all()
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map(template => toDto(db, template))
}

/**
 * The template with its entries for its editor, shown like plan entries. A shift whose service (Dienst) has other
 * times by now comes as a special shift with the saved times (as applyWeekTemplate writes it), so saving the editor
 * keeps exactly those times.
 */
function detailOf(db: Db, template: typeof weekTemplates.$inferSelect): WeekTemplateDetailDto {
  const entries = templateRows(db, template.id).map(({ entry, code, shift }): WeekTemplateEntryDto => {
    const current = entry.kind !== 'shift' || isCurrent(entry, shift)
    const kind = current ? entry.kind : 'special'
    const span = { start: entry.start, end: entry.end, breakStart: entry.breakStart, breakEnd: entry.breakEnd }
    return {
      id: entry.id, employeeId: entry.employeeId, date: '', weekday: entry.weekday, kind,
      codeKey: (code?.key ?? null) as CodeKey | null, creditMode: kind === 'code' ? (code?.creditMode ?? 'none') : 'timed',
      ...span, countsAsStaff: entry.countsAsStaff, templateId: current ? entry.shiftTemplateId : null,
      codeId: entry.absenceCodeId, note: entry.note,
      label: describeEntry({ kind, start: entry.start, end: entry.end }, code?.label ?? null, code?.creditMode ?? null),
      shortLabel: kind === 'shift' ? (shift?.shortLabel || null) : null,
      color: planEntryColor({ kind, countsAsStaff: entry.countsAsStaff }, (code?.color ?? null) as ColorKey | null),
      helpFacilityId: null, groupId: null, homeOffice: entry.homeOffice,
    }
  })
  const ids = [...new Set(entries.map(entry => entry.employeeId))]
  const people = ids.length === 0 ? [] : db.select({ id: employees.id, name: employees.name }).from(employees)
    .where(inArray(employees.id, ids)).orderBy(asc(employees.sortOrder), asc(employees.name)).all()
  return {
    id: template.id, name: template.name, groupId: template.groupId, updatedAt: template.updatedAt, entries,
    infos: infosOf(db, template.id), people,
  }
}

/** One template of the facility with its entries (another facility's id gives week_template_not_found). */
export function getWeekTemplate(db: Db, facilityId: number, id: number): WeekTemplateDetailDto {
  return detailOf(db, requireTemplate(db, facilityId, id))
}

/**
 * The staff a template can plan: the facility's own employees who have not left by today (no helpers), with the
 * contract valid today (the first one when it starts later).
 */
export function weekTemplateStaff(db: Db, facilityId: number, today: IsoDate): WeekTemplateStaffDto[] {
  return loadEmployees(db, facilityId)
    .filter(employee => employee.leftOn === null || employee.leftOn >= today)
    .map((employee) => {
      const { hours } = employee.info
      const period = hours.filter(candidate => candidate.validFrom <= today).at(-1) ?? hours[0]
      return {
        id: employee.id, name: employee.name, shortName: employee.shortName, groupId: employee.groupId,
        weeklyMinutes: period?.weeklyMinutes ?? null, workdays: period?.workdays ?? MONDAY_TO_FRIDAY,
      }
    })
}

/**
 * What the editor checks a template against, loaded as the plan's warnings load it (plan.ts): the facility's active
 * Pflichtdienste, a group rule with its group's name, and the opening hours the warnings use (loadHoursContext).
 */
export function weekTemplateCoverage(db: Db, facilityId: number): WeekTemplateCoverageDto {
  const names = groupNames(db, facilityId)
  const rules = loadCoverageRules(db, facilityId)
    .map(rule => rule.groupId === null ? rule : { ...rule, groupName: names[rule.groupId] ?? '' })
  return { rules, hours: loadHoursContext(db, facilityId) }
}

/**
 * Checks a template from the editor with the rules of saving a week: a name, a group of the facility, at least one
 * entry; each entry on Monday–Sunday (invalid_weekday), for the facility's own staff (a group template: the group's
 * members; employee_not_found otherwise), resolved like a plan entry (service of the facility, valid times, home-office
 * mark only on working time) and only of the kinds a saved week keeps: shifts, special shifts, breaks, VZ and Büro
 * (template_entry_not_allowed for Urlaub, Krank, Schließtag …). A whole Büro/VZ day without times is allowed: filling
 * a week only writes working days of the employee, where it has a daily target. Each cell (employee and weekday) must
 * keep the plan's rules (templateCellConflict); a refusal names it ({ employeeId, weekday, name }). A shift or special
 * shift keeps the countsAsStaff the editor sends (what it opened); missing, it is resolved like in the plan.
 */
function resolveTemplate(db: Db, facilityId: number, input: WeekTemplateInput) {
  const name = requireName(input.name)
  const groupId = input.groupId ?? null
  assertGroup(db, facilityId, groupId)
  if (input.entries.length === 0) throw new ServiceError(400, 'template_empty')
  const staff = new Map(loadEmployees(db, facilityId)
    .filter(employee => groupId === null || employee.groupId === groupId)
    .map(employee => [employee.id, employee]))
  const codes = new Map(loadCodes(db).map(code => [code.id, code]))
  const rows = input.entries.map(({ employeeId, weekday: day, countsAsStaff: givenCounts, ...entryInput }) => {
    if (!Number.isInteger(day) || day < 0 || day >= WEEKDAYS) throw new ServiceError(400, 'invalid_weekday')
    if (!staff.has(employeeId)) throw new ServiceError(400, 'employee_not_found')
    const values = resolveEntry(db, facilityId, entryInput)
    const code = values.absenceCodeId == null ? undefined : codes.get(values.absenceCodeId)
    // Only VZ and Büro: never Urlaub, Krank or the protected codes (Mutterschutz, Beschäftigungsverbot).
    if (values.kind === 'code' && (!isTargetGapCode(code?.key ?? null) || isProtectedCode(code?.key))) {
      throw new ServiceError(400, 'template_entry_not_allowed')
    }
    // The editor keeps a duty's mark as opened (e.g. a changed HK shift, now a special shift, still not counting).
    const isDuty = values.kind === 'shift' || values.kind === 'special'
    const countsAsStaff = isDuty && givenCounts !== undefined ? givenCounts : (values.countsAsStaff ?? true)
    return {
      employeeId, weekday: day, kind: values.kind, shiftTemplateId: values.shiftTemplateId ?? null,
      absenceCodeId: values.absenceCodeId ?? null, start: values.start ?? null, end: values.end ?? null,
      breakStart: values.breakStart ?? null, breakEnd: values.breakEnd ?? null, countsAsStaff,
      note: values.note ?? null, homeOffice: values.homeOffice ?? false, code,
    }
  })
  for (const cell of Map.groupBy(rows, row => `${row.employeeId}:${row.weekday}`).values()) {
    const day = cell.map((row): DomainEntry => ({
      employeeId: row.employeeId, date: '', kind: row.kind, codeKey: row.code?.key ?? null,
      creditMode: row.kind === 'code' ? (row.code?.creditMode ?? 'none') : 'timed',
      start: row.start, end: row.end, breakStart: row.breakStart, breakEnd: row.breakEnd, countsAsStaff: row.countsAsStaff,
    }))
    const conflict = templateCellConflict(day)
    if (conflict) {
      const { employeeId, weekday: refusedDay } = cell[0]!
      throw new ServiceError(400, conflict, { employeeId, weekday: refusedDay, name: staff.get(employeeId)!.name })
    }
  }
  // Info 1 / Info 2 are the facility's day notes: only a template for the whole facility keeps them (a group template
  // none, also when it becomes one).
  const infos = groupId !== null ? [] : input.infos === undefined ? undefined : resolveInfos(input.infos)
  return { name, groupId, rows: rows.map(({ code: _code, ...row }) => row), infos }
}

/**
 * The editor's Info 1 / Info 2 texts as stored: trimmed, a weekday with both empty left out. A weekday outside
 * Monday–Sunday gives invalid_weekday, the same weekday twice invalid_input, a text longer than the plan's info field
 * info_too_long.
 */
function resolveInfos(infos: WeekTemplateInfo[]): WeekTemplateInfo[] {
  const seen = new Set<number>()
  const rows: WeekTemplateInfo[] = []
  for (const { weekday: day, info1: first, info2: second } of infos) {
    if (!Number.isInteger(day) || day < 0 || day >= WEEKDAYS) throw new ServiceError(400, 'invalid_weekday')
    if (seen.has(day)) throw new ServiceError(400, 'invalid_input')
    seen.add(day)
    const info1 = first.trim()
    const info2 = second.trim()
    if (info1.length > TEMPLATE_INFO_MAX || info2.length > TEMPLATE_INFO_MAX) throw new ServiceError(400, 'info_too_long')
    if (info1 || info2) rows.push({ weekday: day, info1, info2 })
  }
  return rows.sort((a, b) => a.weekday - b.weekday)
}

/** Replaces the template's Info 1 / Info 2 texts. */
function writeInfos(db: Db, weekTemplateId: number, infos: WeekTemplateInfo[]): void {
  db.delete(weekTemplateInfos).where(eq(weekTemplateInfos.weekTemplateId, weekTemplateId)).run()
  if (infos.length > 0) db.insert(weekTemplateInfos).values(infos.map(info => ({ ...info, weekTemplateId }))).run()
}

/** The template's Info 1 / Info 2 texts, by weekday. */
function infosOf(db: Db, weekTemplateId: number): WeekTemplateInfo[] {
  return db.select({ weekday: weekTemplateInfos.weekday, info1: weekTemplateInfos.info1, info2: weekTemplateInfos.info2 })
    .from(weekTemplateInfos).where(eq(weekTemplateInfos.weekTemplateId, weekTemplateId)).orderBy(asc(weekTemplateInfos.weekday)).all()
}

/** A name another template of the facility uses (other than `exceptId`) gives name_taken. */
function assertNameFree(db: Db, facilityId: number, name: string, exceptId: number | null): void {
  const taken = db.select({ id: weekTemplates.id }).from(weekTemplates)
    .where(and(eq(weekTemplates.facilityId, facilityId), eq(weekTemplates.name, name))).get()
  if (taken && taken.id !== exceptId) throw new ServiceError(409, 'name_taken')
}

/**
 * Creates a template from the editor's entries (checked like resolveTemplate); unlike saving a week, an existing name
 * is never replaced (name_taken).
 */
export function createWeekTemplate(db: Db, facilityId: number, input: WeekTemplateInput, now: Date = new Date()): WeekTemplateDetailDto {
  const { name, groupId, rows, infos } = resolveTemplate(db, facilityId, input)
  return db.transaction((tx) => {
    assertNameFree(tx, facilityId, name, null)
    const template = tx.insert(weekTemplates).values({ facilityId, name, groupId, updatedAt: now.toISOString() }).returning().get()
    tx.insert(weekTemplateEntries).values(rows.map(row => ({ ...row, weekTemplateId: template.id }))).run()
    writeInfos(tx, template.id, infos ?? [])
    return detailOf(tx, template)
  })
}

/**
 * Replaces name, scope and all entries of a template with the editor's (checked like resolveTemplate); nothing changes
 * when anything is refused. The plan weeks marked with it keep their mark, unless its scope changed: they were filled
 * for another group (or the whole facility), so their marks go.
 */
export function replaceWeekTemplate(
  db: Db, facilityId: number, id: number, input: WeekTemplateInput, now: Date = new Date(),
): WeekTemplateDetailDto {
  const before = requireTemplate(db, facilityId, id)
  const { name, groupId, rows, infos } = resolveTemplate(db, facilityId, input)
  return db.transaction((tx) => {
    assertNameFree(tx, facilityId, name, id)
    const template = tx.update(weekTemplates).set({ name, groupId, updatedAt: now.toISOString() })
      .where(eq(weekTemplates.id, id)).returning().get()
    tx.delete(weekTemplateEntries).where(eq(weekTemplateEntries.weekTemplateId, id)).run()
    tx.insert(weekTemplateEntries).values(rows.map(row => ({ ...row, weekTemplateId: id }))).run()
    if (infos !== undefined) writeInfos(tx, id, infos)
    if (before.groupId !== groupId) tx.delete(weekTemplateMarks).where(eq(weekTemplateMarks.weekTemplateId, id)).run()
    return detailOf(tx, template)
  })
}

/**
 * Saves Monday–Sunday of the week starting at weekStart as a template: shifts, special shifts, breaks, VZ and Büro,
 * with their home-office mark (filling a week writes it again).
 * One-off entries (Urlaub, Krank, Fortbildung …) are left out. Only the facility's staff count (not its helpers, and not
 * their help-out days elsewhere). A group template (groupId set) keeps only the duties of the group's current members
 * that count for the group, so duties moved to another group stay out; they are stored without group, being home-group
 * duties. An existing template of the same name for the same group (or the whole facility) is replaced; a name that
 * another template of the facility uses gives name_taken.
 */
export function saveWeekTemplate(
  db: Db, facilityId: number, input: { name: string; weekStart: IsoDate; groupId?: number | null }, now: Date = new Date(),
): WeekTemplateDto {
  requireMonday(input.weekStart)
  const name = requireName(input.name)
  const groupId = input.groupId ?? null
  assertGroup(db, facilityId, groupId)
  const members = new Set(loadEmployees(db, facilityId).filter(employee => employee.groupId === groupId).map(employee => employee.id))
  // The facility's plan without its helpers (helpFacilityId set) and without its staff's help-outs elsewhere.
  const working = loadEntries(db, { from: input.weekStart, to: addDays(input.weekStart, WEEKDAYS - 1), planFacilityId: facilityId })
    .filter(entry => entry.helpFacilityId === null)
    // Only VZ and Büro of the codes: never one-off absences, never Mutterschutz or Beschäftigungsverbot.
    .filter(entry => entry.kind !== 'code' || (entry.codeKey !== null && TARGET_GAP_CODES.includes(entry.codeKey) && !isProtectedCode(entry.codeKey)))
    // A member's duty counts for the group unless it was moved to another one (the home group is stored as none).
    .filter(entry => groupId === null || (members.has(entry.employeeId) && (entry.groupId ?? groupId) === groupId))
  if (working.length === 0) throw new ServiceError(400, 'empty_week')

  return db.transaction((tx) => {
    const updatedAt = now.toISOString()
    const existing = tx.select().from(weekTemplates)
      .where(and(eq(weekTemplates.facilityId, facilityId), eq(weekTemplates.name, name))).get()
    if (existing && existing.groupId !== groupId) throw new ServiceError(409, 'name_taken')
    const template = existing
      ? tx.update(weekTemplates).set({ updatedAt }).where(eq(weekTemplates.id, existing.id)).returning().get()
      : tx.insert(weekTemplates).values({ facilityId, name, groupId, updatedAt }).returning().get()
    tx.delete(weekTemplateEntries).where(eq(weekTemplateEntries.weekTemplateId, template.id)).run()
    tx.insert(weekTemplateEntries).values(working.map(entry => ({
      weekTemplateId: template.id, employeeId: entry.employeeId, weekday: weekday(entry.date), kind: entry.kind,
      shiftTemplateId: entry.templateId, absenceCodeId: entry.codeId, start: entry.start, end: entry.end,
      breakStart: entry.breakStart, breakEnd: entry.breakEnd, countsAsStaff: entry.countsAsStaff, note: entry.note,
      homeOffice: entry.homeOffice,
    }))).run()
    // The week's Info 1 / Info 2 per weekday: the facility's day notes, so only for a template of the whole facility.
    const notes = groupId !== null ? [] : tx.select().from(dayNotes).where(and(
      eq(dayNotes.facilityId, facilityId), gte(dayNotes.date, input.weekStart), lte(dayNotes.date, addDays(input.weekStart, WEEKDAYS - 1)),
    )).all()
    writeInfos(tx, template.id, resolveInfos(notes.map(note => ({ weekday: weekday(note.date), info1: note.info1, info2: note.info2 }))))
    markWeek(tx, template, input.weekStart)
    return toDto(tx, template)
  })
}

/** Template names are unique per facility. */
export function renameWeekTemplate(db: Db, facilityId: number, id: number, newName: string): void {
  requireTemplate(db, facilityId, id)
  const name = requireName(newName)
  const taken = db.select().from(weekTemplates)
    .where(and(eq(weekTemplates.facilityId, facilityId), eq(weekTemplates.name, name), ne(weekTemplates.id, id))).get()
  if (taken) throw new ServiceError(409, 'name_taken')
  db.update(weekTemplates).set({ name }).where(eq(weekTemplates.id, id)).run()
}

export function deleteWeekTemplate(db: Db, facilityId: number, id: number): void {
  requireTemplate(db, facilityId, id)
  db.delete(weekTemplates).where(eq(weekTemplates.id, id)).run()
}

/**
 * Copies the template into the week starting at weekStart, for the facility's own staff only (a group template: only
 * the group's current members). A day is only filled when the employee's day is empty (a help-out elsewhere counts as
 * filled) and it is one of their working days (employed, contract day, no public holiday) outside any closure; nothing
 * is overwritten. Saturday and Sunday hold entries only where the template has some (older templates have none): they
 * are filled on any day the employee is employed, outside public holidays and closures, also off the contract days
 * (weekend duties are planned extra) – except a whole Büro/VZ day, which needs a contract day (a daily target to credit,
 * as the plan refuses it otherwise).
 */
export function applyWeekTemplate(
  db: Db, actor: SessionUser, facilityId: number, id: number, weekStart: IsoDate, now: Date = new Date(),
): WeekTemplateApplyResult {
  requireMonday(weekStart)
  const template = requireTemplate(db, facilityId, id)
  // A protected code (Mutterschutz, Beschäftigungsverbot) in an old template is never written into the plan.
  const protectedIds = protectedCodeIds(db)
  const rows = db.select().from(weekTemplateEntries).where(eq(weekTemplateEntries.weekTemplateId, id))
    .orderBy(asc(weekTemplateEntries.start), asc(weekTemplateEntries.id)).all()
    .filter(row => row.absenceCodeId === null || !protectedIds.has(row.absenceCodeId))
  // Employees who have since moved to another facility (or, for a group template, to another group) are skipped.
  const staff = new Map(loadEmployees(db, facilityId)
    .filter(employee => template.groupId === null || employee.groupId === template.groupId)
    .map(employee => [employee.id, employee]))
  const closures = loadClosures(db, facilityId)
  const groups = Map.groupBy(rows, row => `${row.employeeId}:${row.weekday}`)
  const shifts = new Map(db.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, facilityId)).all()
    .map(shift => [shift.id, shift]))
  // A saved shift whose service (Dienst) was changed or deleted since keeps its saved times as a special shift,
  // so the plan never shows e.g. "F1" with times that are no longer F1's.
  const keepTimesOf = (row: SavedTimes & Pick<typeof weekTemplateEntries.$inferSelect, 'kind' | 'shiftTemplateId'>) => {
    if (row.kind !== 'shift') return {}
    const shift = row.shiftTemplateId === null ? undefined : shifts.get(row.shiftTemplateId)
    return isCurrent(row, shift) ? {} : { kind: 'special' as const, shiftTemplateId: null }
  }
  const timestamp = now.toISOString()
  const result: WeekTemplateApplyResult = { filled: 0, skipped: 0, infosKept: [] }
  const names = groupNames(db, facilityId)

  db.transaction((tx) => {
    // Every entry of the staff counts, so a day helping out in another facility is occupied too.
    const occupied = new Set(loadEntries(tx, { from: weekStart, to: addDays(weekStart, WEEKDAYS - 1), homeFacilityId: facilityId })
      .map(entry => `${entry.employeeId}:${entry.date}`))
    for (const group of groups.values()) {
      const { employeeId, weekday: day } = group[0]!
      const date = addDays(weekStart, day)
      const employee = staff.get(employeeId)
      if (!employee || !fillsDay(employee.info, date, day, group) || closureOn(closures, date) || occupied.has(`${employeeId}:${date}`)) {
        result.skipped += 1
        continue
      }
      const cell = { employeeId, date }
      const before = describeCellAt(tx, cell, names)
      tx.insert(entries).values(group.map(({ id: _id, weekTemplateId: _template, weekday: _day, ...values }) => ({
        ...values, ...keepTimesOf(values), date, closureId: null, updatedAt: timestamp, updatedBy: actor.id,
      }))).run()
      logChange(tx, {
        facilityId, ...cell, field: 'entry', before, after: describeCellAt(tx, cell, names), actorId: actor.id, now: timestamp,
      })
      result.filled += 1
    }
    // Info 1 / Info 2: an empty field of the day gets the template's text; a field with another text keeps it and its
    // day is reported. Public holidays and closures get them too (they are notes, not duties). Written like a manual
    // edit (setDayNote: change log in a released month, a pending change until the next release). Only a template of the
    // whole facility has infos (an old group template's rows are not written either: the notes are the facility's).
    const kept = new Set<IsoDate>()
    let infosWritten = 0
    for (const info of template.groupId === null ? infosOf(tx, id) : []) {
      const date = addDays(weekStart, info.weekday)
      const current = tx.select().from(dayNotes).where(and(eq(dayNotes.facilityId, facilityId), eq(dayNotes.date, date))).get()
      for (const field of ['info1', 'info2'] as const) {
        const text = info[field]
        const existing = current?.[field] ?? ''
        if (!text || existing === text) continue
        if (existing) {
          kept.add(date)
          continue
        }
        setDayNote(tx, actor, facilityId, date, field, text, now)
        infosWritten += 1
      }
    }
    result.infosKept = [...kept].sort()
    if (result.filled > 0 || infosWritten > 0) {
      markWeek(tx, template, weekStart)
      recordUse(tx, actor, template, weekStart, timestamp)
    }
  })
  return result
}

/**
 * A fingerprint of the facility's plan of the week (its own staff's and its helpers' entries there, with what they
 * hold): any entry entered, changed or deleted gives another one. Robust where the change log is not: that one only
 * records released months, and entries' own timestamps tell nothing about deleted entries. It also changes without
 * anybody editing the week: someone moves in or out, a service is deleted, adoptShiftTimes, a reset to the release
 * (new ids); an edit changed back counts as unchanged (docs/BETRIEB.md, „Dienstplanvorlagen“).
 */
function weekFingerprint(db: Db, facilityId: number, weekStart: IsoDate): string {
  const week = loadEntries(db, { from: weekStart, to: addDays(weekStart, WEEKDAYS - 1), planFacilityId: facilityId })
    .map(entry => [
      entry.id, entry.employeeId, entry.date, entry.kind, entry.templateId, entry.codeId, entry.start, entry.end, entry.breakStart,
      entry.breakEnd, entry.countsAsStaff, entry.groupId, entry.homeOffice, entry.note, entry.helpFacilityId,
    ])
    .sort((a, b) => (a[0] as number) - (b[0] as number))
  return createHash('sha256').update(JSON.stringify(week)).digest('hex')
}

/** Records that the template filled the week (in the apply's transaction, after its entries are written). */
function recordUse(db: Db, actor: SessionUser, template: typeof weekTemplates.$inferSelect, weekStart: IsoDate, appliedAt: string): void {
  db.insert(weekTemplateUses).values({
    facilityId: template.facilityId, weekStart, templateId: template.id, templateName: template.name, appliedAt,
    appliedBy: actor.username, weekFingerprint: weekFingerprint(db, template.facilityId, weekStart),
  }).run()
}

/**
 * The templates applied to the facility's plan weeks (by Monday) from `from` to `to`, the latest first, and whether the
 * week's plan changed since the latest one (its fingerprint then differs from now). Weeks without any are left out.
 */
export function weekTemplateUsesOf(
  db: Db, facilityId: number, from: IsoDate, to: IsoDate,
): Map<IsoDate, { uses: WeekTemplateUseDto[]; changedSince: boolean }> {
  const rows = db.select().from(weekTemplateUses)
    .where(and(eq(weekTemplateUses.facilityId, facilityId), gte(weekTemplateUses.weekStart, from), lte(weekTemplateUses.weekStart, to)))
    .orderBy(desc(weekTemplateUses.appliedAt), desc(weekTemplateUses.id))
    .all()
  const result = new Map<IsoDate, { uses: WeekTemplateUseDto[]; changedSince: boolean }>()
  for (const [weekStart, uses] of Map.groupBy(rows, row => row.weekStart)) {
    result.set(weekStart, {
      uses: uses.map(({ templateName, appliedAt, appliedBy }) => ({ templateName, appliedAt, appliedBy })),
      changedSince: uses[0]!.weekFingerprint !== weekFingerprint(db, facilityId, weekStart),
    })
  }
  return result
}

/**
 * Whether filling a week writes the template's day into the plan, before closures and occupied cells: Monday–Friday on
 * the employee's working days; Saturday/Sunday on every day employed without a public holiday, a whole Büro/VZ day only
 * on a working day (see applyWeekTemplate). Never on a day of an entered long absence (Langzeitkrank, Kur/Reha,
 * Sonstiges): the person is not there.
 */
function fillsDay(
  info: EmploymentInfo, date: IsoDate, day: number,
  cell: Pick<typeof weekTemplateEntries.$inferSelect, 'kind' | 'absenceCodeId' | 'start' | 'end'>[],
): boolean {
  if (longAbsenceOn(info.longAbsences, date)) return false
  if (!isTemplateWeekend(day) || cell.some(row => row.kind === 'code' && row.start === null && row.end === null)) {
    return isWorkday(info, date)
  }
  return isEmployedOn(info, date) && !isHolidayIn(date, info.holidays)
}

/**
 * Remembers which template a plan week was saved as or filled from (the latest one wins), for the whole facility
 * (group 0) or for the template's group.
 */
function markWeek(db: Db, template: typeof weekTemplates.$inferSelect, weekStart: IsoDate): void {
  const weekTemplateId = template.id
  db.insert(weekTemplateMarks).values({ facilityId: template.facilityId, groupId: template.groupId ?? 0, weekStart, weekTemplateId })
    .onConflictDoUpdate({
      target: [weekTemplateMarks.facilityId, weekTemplateMarks.groupId, weekTemplateMarks.weekStart], set: { weekTemplateId },
    }).run()
}

/**
 * Template names per plan week (by its Monday) of the facility between from and to, for the plan's week rows: keyed
 * '0' for the whole facility's template and by group id for a group's template. Weeks without any are left out.
 */
export function weekTemplateNames(
  db: Db, facilityId: number, from: IsoDate, to: IsoDate,
): Map<IsoDate, Record<string, string>> {
  const rows = db.select({ weekStart: weekTemplateMarks.weekStart, groupId: weekTemplateMarks.groupId, name: weekTemplates.name })
    .from(weekTemplateMarks)
    .innerJoin(weekTemplates, eq(weekTemplateMarks.weekTemplateId, weekTemplates.id))
    .where(and(
      eq(weekTemplateMarks.facilityId, facilityId),
      gte(weekTemplateMarks.weekStart, from), lte(weekTemplateMarks.weekStart, to),
    ))
    .orderBy(asc(weekTemplateMarks.weekStart), asc(weekTemplateMarks.groupId))
    .all()
  const names = new Map<IsoDate, Record<string, string>>()
  for (const row of rows) {
    const week = names.get(row.weekStart) ?? {}
    week[String(row.groupId)] = row.name
    names.set(row.weekStart, week)
  }
  return names
}

/**
 * After a service (Dienst) got new times: its fixed shifts in all templates that still have the old times get the new
 * ones, unless that would clash with other entries of the same template day. Returns how many were updated.
 */
export function adoptShiftTimesInTemplates(
  db: Db, facilityId: number, shiftTemplateId: number, oldTimes: TimeSpan, newTimes: TimeSpan,
): number {
  const rows = db.select({ entry: weekTemplateEntries, code: absenceCodes })
    .from(weekTemplateEntries)
    .innerJoin(weekTemplates, eq(weekTemplateEntries.weekTemplateId, weekTemplates.id))
    .leftJoin(absenceCodes, eq(weekTemplateEntries.absenceCodeId, absenceCodes.id))
    .where(eq(weekTemplates.facilityId, facilityId))
    .all()
  const asDomain = ({ entry, code }: (typeof rows)[number]): DomainEntry => ({
    employeeId: entry.employeeId, date: '', kind: entry.kind, codeKey: (code?.key ?? null) as CodeKey | null,
    creditMode: entry.kind === 'code' ? (code?.creditMode ?? 'none') : 'timed',
    start: entry.start, end: entry.end, breakStart: entry.breakStart, breakEnd: entry.breakEnd, countsAsStaff: entry.countsAsStaff,
  })
  let updated = 0
  for (const row of rows) {
    const { entry } = row
    const outdated = entry.kind === 'shift' && entry.shiftTemplateId === shiftTemplateId && entry.start === oldTimes.start
      && entry.end === oldTimes.end && entry.breakStart === oldTimes.breakStart && entry.breakEnd === oldTimes.breakEnd
    if (!outdated) continue
    const day = rows.filter(other => other.entry.weekTemplateId === entry.weekTemplateId
      && other.entry.employeeId === entry.employeeId && other.entry.weekday === entry.weekday)
    const changed = { ...asDomain(row), ...newTimes }
    if (dayConflict(day.map(other => (other === row ? changed : asDomain(other))), changed)) continue
    db.update(weekTemplateEntries).set(newTimes).where(eq(weekTemplateEntries.id, entry.id)).run()
    updated += 1
  }
  return updated
}
