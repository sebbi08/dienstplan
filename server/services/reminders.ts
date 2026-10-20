import { and, desc, eq, gte, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { ageOn, childStatus, hiddenFromViewer, type ChildStatus } from '../../shared/domain/children'
import { addDays } from '../../shared/domain/dates'
import { groupRight } from '../../shared/domain/groupAccess'
import { docDue, inWindow, nextBirthday, sortReminders, type DocSettings, type ReminderKind } from '../../shared/domain/reminders'
import { isManager } from '../../shared/domain/roles'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { DevelopmentDocDto, ReminderDto, ReminderSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childDevelopmentDocs, children, employees } from '../db/schema'
import { loadEditableChild, type ChildRow } from '../lib/childRecord'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { meetingsOnDay } from './parentMeetings'
import { getReminderSettings } from './reminderSettings'
import { getSchoolSettings, schoolLeavers } from './schoolChildren'

type DocRow = typeof childDevelopmentDocs.$inferSelect

/** A documentation setting with its „gilt seit“. */
interface DocSetting { doc: DocSettings; since: IsoDate | null }

/** The documentation setting for a child of this group (null = without group: the facility's own setting). */
function docSettingsLookup(settings: ReminderSettingsDto): (groupId: number | null) => DocSetting {
  const noGroup: DocSetting = { doc: settings.noGroupDoc, since: settings.noGroupDocSince }
  const byGroup = new Map(settings.groups.map(group => [group.groupId, { doc: group.doc, since: group.docSince }]))
  return groupId => (groupId === null ? noGroup : byGroup.get(groupId) ?? noGroup)
}

/** The latest „Erledigt“ of each of these children (the latest day; on one day the last entered). */
function latestDone(db: Db, childIds: number[]): Map<number, DocRow> {
  const latest = new Map<number, DocRow>()
  if (childIds.length === 0) return latest
  const rows = db.select().from(childDevelopmentDocs).where(inArray(childDevelopmentDocs.childId, childIds))
    .orderBy(desc(childDevelopmentDocs.doneOn), desc(childDevelopmentDocs.id)).all()
  for (const row of rows) if (!latest.has(row.childId)) latest.set(row.childId, row)
  return latest
}

/** The day the child's documentation is due next under its group's setting today (null: off, or no date to count from). */
function dueOf(row: ChildRow, setting: DocSetting, lastDone: DocRow | undefined, today: IsoDate): IsoDate | null {
  return docDue({ ...row, since: setting.since, lastDone: lastDone?.doneOn ?? null }, setting.doc, today)
}

/**
 * The reminders of the box „Erinnerungen“ for this viewer, sorted (`sortReminders`). Children's entries (documentation,
 * birthday, leaving) only for active children of a group the viewer may write in; parent meetings also for children who
 * have not started yet (contract before the entry, Vormerkung; by their promised or wished-for group, and not when the
 * tablet's switches hide them from the viewer). Staff with a group of their own see
 * that group (and children without group), never a group they may only read; everybody else sees every child. A
 * documentation is listed from its due day minus the group's lead weeks until it is done (overdue from the due day); a
 * parent meeting only on its day, all day, with its start and kind (never the note); a
 * birthday from the facility's lead days before until the day; a leaving day (registered, or the day before the school
 * start the daily run deregisters on while the automatic leaving is switched on) from the lead weeks before until the
 * day. Staff birthdays of every employee of the facility who has not left, for everyone (no year, no age).
 */
export function listReminders(db: Db, viewer: ChildViewer, today: IsoDate): ReminderDto[] {
  const { facilityId } = viewer
  const settings = getReminderSettings(db, facilityId)
  const docSettingsOf = docSettingsLookup(settings)
  const writable = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => groupRight(row.groupId, viewer.groups) === 'write')
  const rows = writable.filter(row => childStatus(row, today) === 'active')
  // Children who have not started yet (contract before the entry, Vormerkung) and are still to come, unless the
  // tablet's switches hide them from the viewer: only their parent meetings are reminded.
  const planned = writable.filter(row => childStatus(row, today) === 'planned'
    && (row.leftOn === null || row.leftOn >= today) && !hiddenFromViewer(row, viewer.visibility, today))
  const visible = new Map(rows.map(row => [row.id, row]))
  const meetingChildren = new Map([...rows, ...planned].map(row => [row.id, row]))
  const done = latestDone(db, rows.map(row => row.id))
  const items: ReminderDto[] = []

  const addChildItem = (
    row: ChildRow, kind: ReminderKind, date: IsoDate, leadDays: number,
    extra: Partial<Pick<ReminderDto, 'age' | 'time' | 'meetingKind'>> = {},
  ) => {
    const state = inWindow(date, leadDays, today)
    if (state === 'before') return
    items.push({
      kind, date, state, name: `${row.firstName} ${row.lastName}`, childId: row.id, age: null,
      ownChild: row.keyEducatorId !== null && row.keyEducatorId === viewer.employeeId, canDone: kind === 'doc',
      time: null, meetingKind: null, ...extra,
    })
  }

  const leavingLead = settings.leavingLeadWeeks * 7
  for (const row of rows) {
    const docSetting = docSettingsOf(row.groupId)
    const due = dueOf(row, docSetting, done.get(row.id), today)
    if (due !== null) addChildItem(row, 'doc', due, docSetting.doc.leadWeeks * 7)
    const birthday = nextBirthday(row.birthDate.slice(5), today)
    addChildItem(row, 'birthday', birthday, settings.birthdayLeadDays, { age: ageOn(row.birthDate, birthday).years })
    // An active child's leaving day is today or later.
    if (row.leftOn !== null) addChildItem(row, 'leaving', row.leftOn, leavingLead)
  }

  // Parent meetings only on their day, the whole day (also once begun); nothing to mark done, the next day they are
  // gone.
  for (const meeting of meetingsOnDay(db, [...meetingChildren.keys()], today)) {
    addChildItem(meetingChildren.get(meeting.childId)!, 'meeting', today, 0, { time: meeting.start, meetingKind: meeting.kind })
  }

  // The children the daily run will deregister within the lead weeks: as the selection would be on the day after the
  // window's last day (their leaving days are the day before the school start). Only those without a leaving day.
  if (getSchoolSettings(db, facilityId).autoLeave) {
    for (const leaver of schoolLeavers(db, facilityId, addDays(today, leavingLead + 1))) {
      const row = visible.get(leaver.id)
      if (row && leaver.leftOn >= today) addChildItem(row, 'leaving', leaver.leftOn, leavingLead)
    }
  }

  const staff = db.select({ name: employees.name, birthday: employees.birthday }).from(employees)
    .where(and(eq(employees.facilityId, facilityId), isNotNull(employees.birthday),
      or(isNull(employees.leftOn), gte(employees.leftOn, today)))).all()
  for (const person of staff) {
    const date = nextBirthday(person.birthday!, today)
    const state = inWindow(date, settings.staffBirthdayLeadDays, today)
    if (state === 'before') continue
    items.push({
      kind: 'staffBirthday', date, state, name: person.name, childId: null, age: null, ownChild: false, canDone: false,
      time: null, meetingKind: null,
    })
  }
  return sortReminders(items)
}

/**
 * The record's „Entwicklungsdokumentation“: the latest „Erledigt“, the next due day under the setting of the child's
 * group today (only for an active child) and what the viewer may do (see `markDocDone`, `undoDocDone`).
 */
export function developmentDocOf(
  db: Db, viewer: ChildViewer, row: ChildRow, status: ChildStatus, today: IsoDate,
): DevelopmentDocDto {
  const last = latestDone(db, [row.id]).get(row.id)
  const writes = groupRight(row.groupId, viewer.groups) === 'write'
  const active = status === 'active'
  return {
    lastDone: last ? { id: last.id, date: last.doneOn, name: last.doneByName } : null,
    nextDue: active ? dueOf(row, docSettingsLookup(getReminderSettings(db, viewer.facilityId))(row.groupId), last, today) : null,
    canUndo: last !== undefined && status !== 'archived' && writes && (isManager(viewer.role) || last.doneOn === today),
    canDone: active && writes,
  }
}

/**
 * Marks the child's documentation done today (Berlin) with the viewer as the person: the account, the employee and the
 * name, so a person without account at the tablet is stored by name. Whoever may write in the child's group may (403
 * group_read_only for a group the viewer may only read; 404 child_not_found for a child the viewer does not see, of
 * another facility, not active yet or archived; 409 child_archived for managers). Returns the entry's id. Once per day:
 * when the child already has an entry of today (a double tap, or two people), that entry's id is returned unchanged.
 */
export function markDocDone(db: Db, viewer: ChildViewer, childId: number, now: Date = new Date()): number {
  const today = nowInBerlin(now).date
  const row = loadEditableChild(db, viewer, viewer.facilityId, childId, today, now)
  if (childStatus(row, today) !== 'active') throw new ServiceError(404, 'child_not_found')
  const existing = db.select({ id: childDevelopmentDocs.id }).from(childDevelopmentDocs)
    .where(and(eq(childDevelopmentDocs.childId, childId), eq(childDevelopmentDocs.doneOn, today))).get()
  if (existing) return existing.id
  return db.insert(childDevelopmentDocs).values({
    childId, doneOn: today, doneByUserId: viewer.id, doneByEmployeeId: viewer.employeeId, doneByName: viewer.name,
    createdAt: now.toISOString(),
  }).returning({ id: childDevelopmentDocs.id }).get().id
}

/**
 * Takes the child's latest „Erledigt“ back; the one before counts again. Only the latest (409 undo_not_latest for an
 * older one). Leitung and Träger may any time, everybody else only on the day it was marked (403 undo_too_late), and
 * only with the write right in the child's group (as `markDocDone`, so 409 child_archived for managers once the child
 * has left). 404 development_doc_not_found for an unknown entry or one of another facility's child.
 */
export function undoDocDone(db: Db, viewer: ChildViewer, docId: number, now: Date = new Date()): void {
  const today = nowInBerlin(now).date
  const doc = db.select({ id: childDevelopmentDocs.id, childId: childDevelopmentDocs.childId, doneOn: childDevelopmentDocs.doneOn })
    .from(childDevelopmentDocs).innerJoin(children, eq(children.id, childDevelopmentDocs.childId))
    .where(and(eq(childDevelopmentDocs.id, docId), eq(children.facilityId, viewer.facilityId))).get()
  if (!doc) throw new ServiceError(404, 'development_doc_not_found')
  loadEditableChild(db, viewer, viewer.facilityId, doc.childId, today, now)
  if (latestDone(db, [doc.childId]).get(doc.childId)?.id !== doc.id) throw new ServiceError(409, 'undo_not_latest')
  if (!isManager(viewer.role) && doc.doneOn !== today) throw new ServiceError(403, 'undo_too_late')
  db.delete(childDevelopmentDocs).where(eq(childDevelopmentDocs.id, docId)).run()
}
