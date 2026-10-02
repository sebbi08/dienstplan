import { and, asc, eq, ne } from 'drizzle-orm'
import { addDays, isValidIsoDate, weekday } from '../../shared/domain/dates'
import { describeEntry } from '../../shared/domain/describe'
import { isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import { TARGET_GAP_CODES } from '../../shared/domain/warnings'
import type { SessionUser, WeekTemplateApplyResult, WeekTemplateDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, entries, shiftTemplates, weekTemplateEntries, weekTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { describeCellAt } from './entries'
import { closureOn, loadClosures, loadEmployees, loadEntries } from './queries'

/** A template covers Monday to Friday. */
const WEEKDAYS = 5

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'name_required')
  return trimmed
}

function requireMonday(weekStart: IsoDate): void {
  if (!isValidIsoDate(weekStart) || weekday(weekStart) !== 0) throw new ServiceError(400, 'not_a_monday')
}

function requireTemplate(db: Db, id: number) {
  const template = db.select().from(weekTemplates).where(eq(weekTemplates.id, id)).get()
  if (!template) throw new ServiceError(404, 'week_template_not_found')
  return template
}

function toDto(db: Db, template: typeof weekTemplates.$inferSelect): WeekTemplateDto {
  const rows = db.select({ entry: weekTemplateEntries, code: absenceCodes, shift: shiftTemplates })
    .from(weekTemplateEntries)
    .leftJoin(absenceCodes, eq(weekTemplateEntries.absenceCodeId, absenceCodes.id))
    .leftJoin(shiftTemplates, eq(weekTemplateEntries.shiftTemplateId, shiftTemplates.id))
    .where(eq(weekTemplateEntries.weekTemplateId, template.id))
    .orderBy(asc(weekTemplateEntries.weekday), asc(weekTemplateEntries.start), asc(weekTemplateEntries.id))
    .all()
  const preview = loadEmployees(db).flatMap((employee) => {
    const own = rows.filter(row => row.entry.employeeId === employee.id)
    if (own.length === 0) return []
    const days = Array.from({ length: WEEKDAYS }, (_, day) => own.filter(row => row.entry.weekday === day)
      .map(({ entry, code, shift }) => (entry.kind === 'shift' && shift?.shortLabel) || describeEntry(entry, code?.label ?? null))
      .join(' + '))
    return [{ employeeId: employee.id, name: employee.name, days }]
  })
  return { id: template.id, name: template.name, updatedAt: template.updatedAt, rows: preview }
}

export function listWeekTemplates(db: Db): WeekTemplateDto[] {
  return db.select().from(weekTemplates).all()
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map(template => toDto(db, template))
}

/**
 * Saves Monday–Friday of the week starting at weekStart as a template: shifts, special shifts, breaks, VZ and Büro.
 * One-off entries (Urlaub, Krank, Fortbildung …) are left out. An existing template of the same name is replaced.
 */
export function saveWeekTemplate(db: Db, input: { name: string; weekStart: IsoDate }, now: Date = new Date()): WeekTemplateDto {
  requireMonday(input.weekStart)
  const name = requireName(input.name)
  const working = loadEntries(db, { from: input.weekStart, to: addDays(input.weekStart, WEEKDAYS - 1) })
    .filter(entry => entry.kind !== 'code' || (entry.codeKey !== null && TARGET_GAP_CODES.includes(entry.codeKey)))
  if (working.length === 0) throw new ServiceError(400, 'empty_week')

  return db.transaction((tx) => {
    const updatedAt = now.toISOString()
    const existing = tx.select().from(weekTemplates).where(eq(weekTemplates.name, name)).get()
    const template = existing
      ? tx.update(weekTemplates).set({ updatedAt }).where(eq(weekTemplates.id, existing.id)).returning().get()
      : tx.insert(weekTemplates).values({ name, updatedAt }).returning().get()
    tx.delete(weekTemplateEntries).where(eq(weekTemplateEntries.weekTemplateId, template.id)).run()
    tx.insert(weekTemplateEntries).values(working.map(entry => ({
      weekTemplateId: template.id, employeeId: entry.employeeId, weekday: weekday(entry.date), kind: entry.kind,
      shiftTemplateId: entry.templateId, absenceCodeId: entry.codeId, start: entry.start, end: entry.end,
      breakStart: entry.breakStart, breakEnd: entry.breakEnd, countsAsStaff: entry.countsAsStaff, note: entry.note,
    }))).run()
    return toDto(tx, template)
  })
}

export function renameWeekTemplate(db: Db, id: number, newName: string): void {
  requireTemplate(db, id)
  const name = requireName(newName)
  if (db.select().from(weekTemplates).where(and(eq(weekTemplates.name, name), ne(weekTemplates.id, id))).get()) {
    throw new ServiceError(409, 'name_taken')
  }
  db.update(weekTemplates).set({ name }).where(eq(weekTemplates.id, id)).run()
}

export function deleteWeekTemplate(db: Db, id: number): void {
  requireTemplate(db, id)
  db.delete(weekTemplates).where(eq(weekTemplates.id, id)).run()
}

/**
 * Copies the template into the week starting at weekStart. A day is only filled when the employee's cell is empty and
 * it is one of their working days (employed, contract day, no public holiday) outside any closure; nothing is overwritten.
 */
export function applyWeekTemplate(
  db: Db, actor: SessionUser, id: number, weekStart: IsoDate, now: Date = new Date(),
): WeekTemplateApplyResult {
  requireMonday(weekStart)
  requireTemplate(db, id)
  const rows = db.select().from(weekTemplateEntries).where(eq(weekTemplateEntries.weekTemplateId, id))
    .orderBy(asc(weekTemplateEntries.start), asc(weekTemplateEntries.id)).all()
  const staff = new Map(loadEmployees(db).map(employee => [employee.id, employee]))
  const closures = loadClosures(db)
  const groups = Map.groupBy(rows, row => `${row.employeeId}:${row.weekday}`)
  const timestamp = now.toISOString()
  const result: WeekTemplateApplyResult = { filled: 0, skipped: 0 }

  db.transaction((tx) => {
    const occupied = new Set(loadEntries(tx, { from: weekStart, to: addDays(weekStart, WEEKDAYS - 1) })
      .map(entry => `${entry.employeeId}:${entry.date}`))
    for (const group of groups.values()) {
      const { employeeId, weekday: day } = group[0]!
      const date = addDays(weekStart, day)
      const employee = staff.get(employeeId)
      if (!employee || !isWorkday(employee.info, date) || closureOn(closures, date) || occupied.has(`${employeeId}:${date}`)) {
        result.skipped += 1
        continue
      }
      const cell = { employeeId, date }
      const before = describeCellAt(tx, cell)
      tx.insert(entries).values(group.map(({ id: _id, weekTemplateId: _template, weekday: _day, ...values }) => ({
        ...values, date, closureId: null, updatedAt: timestamp, updatedBy: actor.id,
      }))).run()
      logChange(tx, { ...cell, field: 'entry', before, after: describeCellAt(tx, cell), actorId: actor.id, now: timestamp })
      result.filled += 1
    }
  })
  return result
}
