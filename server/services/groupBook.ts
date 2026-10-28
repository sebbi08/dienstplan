import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { addDays, isoWeekNumber, isValidIsoDate, isWeekend, weekStart } from '../../shared/domain/dates'
import { groupRight } from '../../shared/domain/groupAccess'
import { holidayIn } from '../../shared/domain/holidays'
import type { IsoDate } from '../../shared/domain/types'
import type { GroupBookChangeDto, GroupDayLabel, GroupWeekDto, NoteDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, groupBookChanges, groupDayNotes, groups, groupWeekNotes } from '../db/schema'
import { groupRightOf, type ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { listGroups } from './groups'
import { facilityHolidayRules } from './holidayRules'
import { closureOn, loadClosures } from './queries'

// The group book's weekly overview (spec Wochenübersicht): a theme per group and week and a text per group and day
// (Monday to Friday). Whoever sees a group as their own writes there, also for past weeks; a group the viewer may only
// read answers 403 group_read_only, a group the viewer may not see 404 group_not_found. Every change is logged with
// the person (also a tablet person without account); a write that changes nothing is not.

/** The field of the change log: the week's theme or a day's text. */
export type GroupBookField = 'week' | 'day'

const NO_NOTE: NoteDto = { text: '', updatedAt: null, updatedByName: null }

/** The viewer's group: another facility's, a missing one and one hidden from the viewer are 404 group_not_found. */
function visibleGroup(db: Db, viewer: ChildViewer, groupId: number): { id: number; name: string; write: boolean } {
  const row = db.select({ id: groups.id, name: groups.name }).from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.facilityId, viewer.facilityId))).get()
  const right = row ? groupRightOf(viewer, row.id, 'children.attendance') : 'none'
  if (!row || right === 'none') throw new ServiceError(404, 'group_not_found')
  return { ...row, write: right === 'write' }
}

/** Like `visibleGroup`, but for a write: a group the viewer may only read is 403 group_read_only. */
function writableGroup(db: Db, viewer: ChildViewer, groupId: number): number {
  const group = visibleGroup(db, viewer, groupId)
  if (!group.write) throw new ServiceError(403, 'group_read_only')
  return group.id
}

/** A day of the weekly overview: a valid date from Monday to Friday, else 400 invalid_date. */
function schoolDay(date: IsoDate): IsoDate {
  if (!isValidIsoDate(date) || isWeekend(date)) throw new ServiceError(400, 'invalid_date')
  return date
}

/** The Monday of the week the (valid) date lies in. */
function mondayOf(date: IsoDate): IsoDate {
  if (!isValidIsoDate(date)) throw new ServiceError(400, 'invalid_date')
  return weekStart(date)
}

const toNote = (row: { text: string; updatedAt: string; updatedByName: string } | undefined): NoteDto =>
  row ? { text: row.text, updatedAt: row.updatedAt, updatedByName: row.updatedByName } : NO_NOTE

/**
 * The group the weekly overview opens with when none is chosen: the viewer's own group, otherwise the first one of the
 * facility the viewer sees (404 group_not_found when there is none).
 */
function defaultGroupId(db: Db, viewer: ChildViewer): number {
  const visible = listGroups(db, viewer.facilityId).filter(group => groupRight(group.id, viewer.groups) !== 'none')
  const chosen = visible.find(group => group.id === viewer.groups?.own) ?? visible[0]
  if (!chosen) throw new ServiceError(404, 'group_not_found')
  return chosen.id
}

/**
 * One week of a group's weekly overview (`anyDateInWeek` is any day of it; the week starts on Monday): the theme, the
 * five days with their holiday or closure label (texts for them are the client's), and the groups the viewer may see.
 * Without a group (`null`) the viewer's own group, else the first visible one.
 */
export function getGroupWeek(db: Db, viewer: ChildViewer, groupId: number | null, anyDateInWeek: IsoDate): GroupWeekDto {
  const group = visibleGroup(db, viewer, groupId ?? defaultGroupId(db, viewer))
  const monday = mondayOf(anyDateInWeek)
  const friday = addDays(monday, 4)
  const rules = facilityHolidayRules(db, viewer.facilityId)
  const closureDays = loadClosures(db, viewer.facilityId)
  const theme = db.select().from(groupWeekNotes)
    .where(and(eq(groupWeekNotes.groupId, group.id), eq(groupWeekNotes.weekStart, monday))).get()
  const notes = new Map(db.select().from(groupDayNotes)
    .where(and(eq(groupDayNotes.groupId, group.id), gte(groupDayNotes.date, monday), lte(groupDayNotes.date, friday))).all()
    .map(row => [row.date, row]))
  const facility = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, viewer.facilityId)).get()

  return {
    groupId: group.id,
    groupName: group.name,
    facilityName: facility?.name ?? '',
    weekStart: monday,
    weekNumber: isoWeekNumber(monday),
    theme: toNote(theme),
    days: Array.from({ length: 5 }, (_, index) => {
      const date = addDays(monday, index)
      const holiday = holidayIn(date, rules)
      const closure = closureOn(closureDays, date)
      const label: GroupDayLabel | null = holiday !== null
        ? { kind: 'holiday', key: holiday }
        : closure !== null ? { kind: 'closure', label: closure.label } : null
      return { date, label, note: toNote(notes.get(date)) }
    }),
    canWrite: group.write,
    groups: listGroups(db, viewer.facilityId).flatMap((candidate) => {
      const right = groupRightOf(viewer, candidate.id, 'children.attendance')
      return right === 'none' ? [] : [{ id: candidate.id, name: candidate.name, right }]
    }),
  }
}

/** Logs the change of a field with the person of the viewer. */
function logChange(
  db: Db, viewer: ChildViewer, groupId: number, field: GroupBookField, date: IsoDate, before: string, after: string, now: Date,
): void {
  db.insert(groupBookChanges).values({
    groupId, field, date, before, after, changedAt: now.toISOString(),
    changedByUserId: viewer.id, changedByEmployeeId: viewer.employeeId, changedByName: viewer.name,
  }).run()
}

/**
 * Sets the week's theme ("Wochenthema / geplant"); `week` may be any day of the week, the theme belongs to its Monday.
 * Past weeks may be changed too. A text equal to the stored one (nothing stored = empty) changes and logs nothing.
 */
export function setWeekTheme(
  db: Db, viewer: ChildViewer, groupId: number, week: IsoDate, text: string, now: Date = new Date(),
): void {
  const id = writableGroup(db, viewer, groupId)
  const monday = mondayOf(week)
  const value = text.trim()
  db.transaction((tx) => {
    const existing = tx.select().from(groupWeekNotes)
      .where(and(eq(groupWeekNotes.groupId, id), eq(groupWeekNotes.weekStart, monday))).get()
    const before = existing?.text ?? ''
    if (before === value) return
    const stamp = { text: value, updatedAt: now.toISOString(), updatedByName: viewer.name }
    if (existing) tx.update(groupWeekNotes).set(stamp).where(eq(groupWeekNotes.id, existing.id)).run()
    else tx.insert(groupWeekNotes).values({ groupId: id, weekStart: monday, ...stamp }).run()
    logChange(tx, viewer, id, 'week', monday, before, value, now)
  })
}

/** Sets a day's "Was haben wir gemacht" (Monday to Friday only: 400 invalid_date); no change, nothing logged. */
export function setDayNote(
  db: Db, viewer: ChildViewer, groupId: number, date: IsoDate, text: string, now: Date = new Date(),
): void {
  const id = writableGroup(db, viewer, groupId)
  const day = schoolDay(date)
  const value = text.trim()
  db.transaction((tx) => {
    const existing = tx.select().from(groupDayNotes)
      .where(and(eq(groupDayNotes.groupId, id), eq(groupDayNotes.date, day))).get()
    const before = existing?.text ?? ''
    if (before === value) return
    const stamp = { text: value, updatedAt: now.toISOString(), updatedByName: viewer.name }
    if (existing) tx.update(groupDayNotes).set(stamp).where(eq(groupDayNotes.id, existing.id)).run()
    else tx.insert(groupDayNotes).values({ groupId: id, date: day, ...stamp }).run()
    logChange(tx, viewer, id, 'day', day, before, value, now)
  })
}

/**
 * The changes of a theme (`field` 'week', `date` any day of the week) or of a day's text ('day', Monday to Friday),
 * newest first. Anyone who may see the group may read it.
 */
export function groupBookHistory(
  db: Db, viewer: ChildViewer, groupId: number, field: GroupBookField, date: IsoDate,
): GroupBookChangeDto[] {
  const group = visibleGroup(db, viewer, groupId)
  const key = field === 'week' ? mondayOf(date) : schoolDay(date)
  return db.select({
    id: groupBookChanges.id, before: groupBookChanges.before, after: groupBookChanges.after,
    changedAt: groupBookChanges.changedAt, changedByName: groupBookChanges.changedByName,
  }).from(groupBookChanges)
    .where(and(eq(groupBookChanges.groupId, group.id), eq(groupBookChanges.field, field), eq(groupBookChanges.date, key)))
    .orderBy(desc(groupBookChanges.id)).all()
}
