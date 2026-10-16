import { and, asc, desc, eq, gte, inArray, isNull, lt, ne } from 'drizzle-orm'
import { countsForMeal, dayStatus, pickupOverdue } from '../../shared/domain/childAttendance'
import { childStatus } from '../../shared/domain/children'
import { addDays, dateRange, daysBetween, isWeekend } from '../../shared/domain/dates'
import { isHolidayIn } from '../../shared/domain/holidays'
import { groupOnDay, type GroupEntry } from '../../shared/domain/occupancy'
import { formatTime } from '../../shared/domain/time'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate, Minutes } from '../../shared/domain/types'
import type {
  AttendanceAbsenceInput, AttendanceAnnouncementInput, AttendanceArriveInput, AttendanceChangeDto, AttendanceChildDto,
  AttendanceDayDto, AttendanceDayInput, AttendanceLeaveInput, AttendancePickupChoice, AttendancePickupOption,
  AttendanceStayInput,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  childAttendanceChanges, childAttendanceDays, childAttendanceStays, childContacts, childPickupAnnouncements, children,
  facilities,
} from '../db/schema'
import { loadChild, type ChildRow } from '../lib/childRecord'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { groupHistories } from './childGroupChanges'
import { listGroups } from './groups'
import { facilityHolidayRules } from './holidayRules'
import { closureOn, loadClosures } from './queries'

// Child attendance (Gruppenbuch, spec Anwesenheit): the day list and every write on it. Every child viewer may read
// and write (also older days); each write logs one row per changed field with the person (spec §3.9, §8.2).

type DayRow = typeof childAttendanceDays.$inferSelect
type StayRow = typeof childAttendanceStays.$inferSelect

/** How many earlier days the day list looks back for stays that were never closed. */
const OPEN_STAY_DAYS = 14
/** The longest absence range entered at once. */
const MAX_ABSENCE_DAYS = 366

/** Whether the child is one of the facility's children on that day: active, and not before it was moved here. */
function activeOn(row: ChildRow, date: IsoDate): boolean {
  return childStatus(row, date) === 'active' && (row.facilitySince === null || row.facilitySince <= date)
}

/** The facility's child, active on the date; another facility's, one not yet entered or one who left: 404 child_not_found. */
function attendanceChild(db: Db, viewer: ChildViewer, childId: number, date: IsoDate): ChildRow {
  const row = loadChild(db, viewer.facilityId, childId)
  if (!activeOn(row, date)) throw new ServiceError(404, 'child_not_found')
  return row
}

/** Care days of the facility (spec §2): weekdays that are neither a public holiday of the facility nor a closure day. */
function careDays(db: Db, facilityId: number): (date: IsoDate) => boolean {
  const rules = facilityHolidayRules(db, facilityId)
  const closures = loadClosures(db, facilityId)
  return date => !isWeekend(date) && !isHolidayIn(date, rules) && closureOn(closures, date) === null
}

/** The child's group history (planned changes included; a group of another facility counts as none). */
function historyOf(db: Db, facilityId: number, childId: number): GroupEntry[] {
  return groupHistories(db, facilityId).get(childId) ?? []
}

function findDay(db: Db, childId: number, date: IsoDate): DayRow | undefined {
  return db.select().from(childAttendanceDays)
    .where(and(eq(childAttendanceDays.childId, childId), eq(childAttendanceDays.date, date))).get()
}

/** The day's row, created on the first entry with the child's group of that day. */
function ensureDay(db: Db, childId: number, date: IsoDate, history: GroupEntry[]): DayRow {
  return findDay(db, childId, date)
    ?? db.insert(childAttendanceDays).values({ childId, date, groupId: groupOnDay(history, date) }).returning().get()
}

function staysOf(db: Db, dayId: number): StayRow[] {
  return db.select().from(childAttendanceStays).where(eq(childAttendanceStays.dayId, dayId))
    .orderBy(asc(childAttendanceStays.arrived), asc(childAttendanceStays.id)).all()
}

// ---- change log ----

/** A field of an attendance day as it was and as it is now, as text ('' = empty). */
export interface AttendanceChange { field: string; before: string; after: string }

const timeText = (minutes: Minutes | null) => (minutes === null ? '' : formatTime(minutes))
const flagText = (value: boolean | null) => (value === null ? '' : String(value))

/** Logs the changes that really change something, one row each, with the person of the viewer. */
export function logAttendanceChanges(
  db: Db, viewer: ChildViewer, childId: number, date: IsoDate, changes: AttendanceChange[], now: Date,
): void {
  const changed = changes.filter(change => change.before !== change.after)
  if (changed.length === 0) return
  db.insert(childAttendanceChanges).values(changed.map(change => ({
    childId, date, ...change, changedAt: now.toISOString(),
    changedByUserId: viewer.id, changedByEmployeeId: viewer.employeeId, changedByName: viewer.name,
  }))).run()
}

// ---- pickup persons ----

/** A name as compared with the names of banned persons: trimmed, single spaces, lower case. */
const personKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')

/** The names of the child's contacts with a contact ban, as person keys. */
function bannedNames(db: Db, childId: number): Set<string> {
  return new Set(db.select({ name: childContacts.name }).from(childContacts)
    .where(and(eq(childContacts.childId, childId), eq(childContacts.contactBan, true))).all()
    .map(contact => personKey(contact.name)))
}

/**
 * The person who may take the child home on this day (spec §3.4): a contact of this child with "darf abholen" and no
 * contact ban, or a person announced for this very day of this child who does not carry the name of a banned contact.
 * 400 pickup_person_required without a choice, 400 pickup_person_invalid for everybody else.
 */
function pickupPerson(
  db: Db, childId: number, dayId: number, pickup: AttendancePickupChoice | null | undefined,
): { name: string; contactId: number | null } {
  if (!pickup) throw new ServiceError(400, 'pickup_person_required')
  if (pickup.kind === 'contact') {
    const contact = db.select().from(childContacts)
      .where(and(eq(childContacts.id, pickup.id), eq(childContacts.childId, childId))).get()
    if (!contact || !contact.mayPickUp || contact.contactBan) throw new ServiceError(400, 'pickup_person_invalid')
    return { name: contact.name, contactId: contact.id }
  }
  if (pickup.kind === 'announcement') {
    const announcement = db.select().from(childPickupAnnouncements)
      .where(and(eq(childPickupAnnouncements.id, pickup.id), eq(childPickupAnnouncements.dayId, dayId))).get()
    if (announcement && !bannedNames(db, childId).has(personKey(announcement.name))) {
      return { name: announcement.name, contactId: null }
    }
  }
  throw new ServiceError(400, 'pickup_person_invalid')
}

// ---- reading ----

const byName = (a: ChildRow, b: ChildRow) =>
  a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')
const nameOf = (row: { lastName: string; firstName: string }) => `${row.lastName}, ${row.firstName}`

/**
 * The day list (spec §3): the facility's children active on the date (the tablet's visibility switches do not apply,
 * planned children are never listed), ordered by the group of the day (no group last), then by name; with status,
 * stays, meals, the pickup persons on offer and the open stays of the 14 days before.
 */
export function getAttendanceDay(db: Db, viewer: ChildViewer, date: IsoDate, now: Date = new Date()): AttendanceDayDto {
  const { facilityId } = viewer
  const settings = db.select({ snackTime: facilities.snackTime, lunchTime: facilities.lunchTime, recordBroughtBy: facilities.recordBroughtBy })
    .from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!settings) throw new ServiceError(404, 'facility_not_found')
  const isCareDay = careDays(db, facilityId)(date)
  const clock = nowInBerlin(now)

  const rows = db.select().from(children).where(eq(children.facilityId, facilityId)).all().filter(row => activeOn(row, date))
  const ids = rows.map(row => row.id)
  const days = ids.length === 0 ? [] : db.select().from(childAttendanceDays)
    .where(and(eq(childAttendanceDays.date, date), inArray(childAttendanceDays.childId, ids))).all()
  const dayIds = days.map(day => day.id)
  const stays = dayIds.length === 0 ? [] : db.select().from(childAttendanceStays)
    .where(inArray(childAttendanceStays.dayId, dayIds)).orderBy(asc(childAttendanceStays.arrived), asc(childAttendanceStays.id)).all()
  const announcements = dayIds.length === 0 ? [] : db.select().from(childPickupAnnouncements)
    .where(inArray(childPickupAnnouncements.dayId, dayIds)).orderBy(asc(childPickupAnnouncements.id)).all()
  const contacts = ids.length === 0 ? [] : db.select().from(childContacts)
    .where(inArray(childContacts.childId, ids)).orderBy(asc(childContacts.sortOrder), asc(childContacts.id)).all()
  // Changed = a value that was there was overwritten or removed (a first entry is no change).
  const changed = new Set(ids.length === 0 ? [] : db.selectDistinct({ childId: childAttendanceChanges.childId })
    .from(childAttendanceChanges)
    .where(and(eq(childAttendanceChanges.date, date), inArray(childAttendanceChanges.childId, ids), ne(childAttendanceChanges.before, '')))
    .all().map(row => row.childId))
  const histories = groupHistories(db, facilityId)
  const groups = listGroups(db, facilityId)
  const groupRank = new Map(groups.map((group, index) => [group.id, index]))
  const rank = (groupId: number | null) => (groupId === null ? Infinity : groupRank.get(groupId) ?? Infinity)

  const list = rows.map((row) => {
    const groupId = groupOnDay(histories.get(row.id) ?? [], date)
    return { row, groupId: groupId !== null && groupRank.has(groupId) ? groupId : null }
  }).sort((a, b) => rank(a.groupId) - rank(b.groupId) || byName(a.row, b.row))

  const entries: AttendanceChildDto[] = list.map(({ row, groupId }) => {
    const day = days.find(candidate => candidate.childId === row.id)
    const own = day ? stays.filter(stay => stay.dayId === day.id) : []
    const spans = own.map(stay => ({ arrived: stay.arrived, left: stay.left }))
    const plannedPickup = day?.plannedPickup ?? null
    const ownContacts = contacts.filter(contact => contact.childId === row.id)
    const banned = ownContacts.filter(contact => contact.contactBan)
    const bannedKeys = new Set(banned.map(contact => personKey(contact.name)))
    const ownAnnouncements = day ? announcements.filter(announcement => announcement.dayId === day.id) : []
    const pickupOptions: AttendancePickupOption[] = [
      ...ownContacts.filter(contact => contact.mayPickUp && !contact.contactBan)
        .map(contact => ({ kind: 'contact' as const, id: contact.id, name: contact.name })),
      ...ownAnnouncements.filter(announcement => !bannedKeys.has(personKey(announcement.name)))
        .map(announcement => ({ kind: 'announcement' as const, id: announcement.id, name: announcement.name })),
    ]
    return {
      childId: row.id,
      name: nameOf(row),
      groupId,
      status: dayStatus({ stays: spans, absence: day?.absence ?? null, date, today: clock.date, isCareDay }),
      stays: own.map(stay => ({ id: stay.id, arrived: stay.arrived, left: stay.left, pickedUpBy: stay.pickedUpBy })),
      plannedPickup,
      broughtBy: day?.broughtBy ?? '',
      absence: day?.absence ?? null,
      note: day?.note ?? '',
      allergies: row.allergies,
      snack: countsForMeal(settings.snackTime, spans, plannedPickup, day?.snack ?? null),
      lunch: countsForMeal(settings.lunchTime, spans, plannedPickup, day?.lunch ?? null),
      snackManual: (day?.snack ?? null) !== null,
      lunchManual: (day?.lunch ?? null) !== null,
      announcements: ownAnnouncements.map(announcement => ({
        id: announcement.id, name: announcement.name, announcedBy: announcement.announcedBy,
      })),
      pickupOptions,
      hasContactBan: banned.length > 0,
      contactBanNotes: banned.map(contact => contact.contactBanNote.trim()).filter(note => note !== ''),
      pickupOverdue: pickupOverdue(spans, plannedPickup, date === clock.date, clock.minutes),
      changed: changed.has(row.id),
    }
  })

  const usedGroups = new Set(list.map(item => item.groupId))
  const openStays = db.select({ date: childAttendanceDays.date, childId: childAttendanceDays.childId, lastName: children.lastName, firstName: children.firstName })
    .from(childAttendanceStays)
    .innerJoin(childAttendanceDays, eq(childAttendanceDays.id, childAttendanceStays.dayId))
    .innerJoin(children, eq(children.id, childAttendanceDays.childId))
    .where(and(
      eq(children.facilityId, facilityId), isNull(childAttendanceStays.left),
      gte(childAttendanceDays.date, addDays(date, -OPEN_STAY_DAYS)), lt(childAttendanceDays.date, date),
    )).all()
    .sort((a, b) => a.date.localeCompare(b.date) || a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de'))
    .map(row => ({ date: row.date, childId: row.childId, name: nameOf(row) }))

  const count = (test: (entry: AttendanceChildDto) => boolean) => entries.filter(test).length
  return {
    date,
    isCareDay,
    snackTime: settings.snackTime,
    lunchTime: settings.lunchTime,
    recordBroughtBy: settings.recordBroughtBy,
    counts: {
      present: count(entry => entry.status === 'present'),
      gone: count(entry => entry.status === 'gone'),
      absent: count(entry => !['present', 'gone', 'not_yet'].includes(entry.status)),
      notYet: count(entry => entry.status === 'not_yet'),
      snack: count(entry => entry.snack),
      lunch: count(entry => entry.lunch),
    },
    groups: [
      ...groups.filter(group => usedGroups.has(group.id)).map(group => ({ id: group.id, name: group.name })),
      ...(usedGroups.has(null) ? [{ id: null, name: '' }] : []),
    ],
    children: entries,
    openStays,
  }
}

/** The changes of a child's day, newest first. */
export function attendanceHistory(db: Db, viewer: ChildViewer, childId: number, date: IsoDate): AttendanceChangeDto[] {
  attendanceChild(db, viewer, childId, date)
  return db.select({
    id: childAttendanceChanges.id, field: childAttendanceChanges.field, before: childAttendanceChanges.before,
    after: childAttendanceChanges.after, changedAt: childAttendanceChanges.changedAt, changedByName: childAttendanceChanges.changedByName,
  }).from(childAttendanceChanges)
    .where(and(eq(childAttendanceChanges.childId, childId), eq(childAttendanceChanges.date, date)))
    .orderBy(desc(childAttendanceChanges.id)).all()
}

// ---- writing ----

/**
 * Stamps the child in (spec §3.2): a new stay from `time`; the planned pickup is required (400 planned_pickup_required),
 * a child already here cannot come again (409 already_present). An absence of the day is replaced. Returns the stay's id.
 */
export function arrive(db: Db, viewer: ChildViewer, input: AttendanceArriveInput, now: Date = new Date()): number {
  attendanceChild(db, viewer, input.childId, input.date)
  const plannedPickup = input.plannedPickup ?? null
  if (plannedPickup === null) throw new ServiceError(400, 'planned_pickup_required')
  const history = historyOf(db, viewer.facilityId, input.childId)
  return db.transaction((tx) => {
    const day = ensureDay(tx, input.childId, input.date, history)
    if (staysOf(tx, day.id).some(stay => stay.left === null)) throw new ServiceError(409, 'already_present')
    const { id } = tx.insert(childAttendanceStays).values({ dayId: day.id, arrived: input.time }).returning({ id: childAttendanceStays.id }).get()
    const broughtBy = input.broughtBy === undefined ? day.broughtBy : input.broughtBy.trim()
    tx.update(childAttendanceDays).set({ plannedPickup, broughtBy, absence: null }).where(eq(childAttendanceDays.id, day.id)).run()
    logAttendanceChanges(tx, viewer, input.childId, input.date, [
      { field: 'arrived', before: '', after: timeText(input.time) },
      { field: 'plannedPickup', before: timeText(day.plannedPickup), after: timeText(plannedPickup) },
      { field: 'broughtBy', before: day.broughtBy, after: broughtBy },
      { field: 'absence', before: day.absence ?? '', after: '' },
    ], now)
    return id
  })
}

/**
 * Stamps the child out (spec §3.4): closes the open stay of the day (409 not_present without one) at `time`, not before
 * the arrival (400 leave_before_arrival), with a person who may pick the child up (see `pickupPerson`).
 */
export function leave(db: Db, viewer: ChildViewer, input: AttendanceLeaveInput, now: Date = new Date()): void {
  attendanceChild(db, viewer, input.childId, input.date)
  db.transaction((tx) => {
    const day = findDay(tx, input.childId, input.date)
    const open = day ? staysOf(tx, day.id).find(stay => stay.left === null) : undefined
    if (!day || !open) throw new ServiceError(409, 'not_present')
    if (input.time < open.arrived) throw new ServiceError(400, 'leave_before_arrival')
    const person = pickupPerson(tx, input.childId, day.id, input.pickup)
    tx.update(childAttendanceStays).set({ left: input.time, pickedUpBy: person.name, pickedUpContactId: person.contactId })
      .where(eq(childAttendanceStays.id, open.id)).run()
    logAttendanceChanges(tx, viewer, input.childId, input.date, [
      { field: 'left', before: '', after: timeText(input.time) },
      { field: 'pickedUpBy', before: '', after: person.name },
    ], now)
  })
}

/**
 * A person announced to pick the child up on this day only (spec §3.3); 400 name_required without a name. A person
 * named like one of the child's contacts with a contact ban cannot be announced (400 pickup_person_invalid). Returns the id.
 */
export function announcePickup(db: Db, viewer: ChildViewer, input: AttendanceAnnouncementInput, now: Date = new Date()): number {
  attendanceChild(db, viewer, input.childId, input.date)
  const name = input.name.trim()
  if (name === '') throw new ServiceError(400, 'name_required')
  if (bannedNames(db, input.childId).has(personKey(name))) throw new ServiceError(400, 'pickup_person_invalid')
  const announcedBy = input.announcedBy.trim()
  const history = historyOf(db, viewer.facilityId, input.childId)
  return db.transaction((tx) => {
    const day = ensureDay(tx, input.childId, input.date, history)
    const { id } = tx.insert(childPickupAnnouncements).values({ dayId: day.id, name, announcedBy })
      .returning({ id: childPickupAnnouncements.id }).get()
    logAttendanceChanges(tx, viewer, input.childId, input.date, [
      { field: 'announcement', before: '', after: announcedBy === '' ? name : `${name} (${announcedBy})` },
    ], now)
    return id
  })
}

/** Removes an announced person; 404 announcement_not_found for an unknown one or one of another facility. */
export function removeAnnouncement(db: Db, viewer: ChildViewer, id: number, now: Date = new Date()): void {
  const found = db.select({ announcement: childPickupAnnouncements, day: childAttendanceDays }).from(childPickupAnnouncements)
    .innerJoin(childAttendanceDays, eq(childAttendanceDays.id, childPickupAnnouncements.dayId))
    .innerJoin(children, eq(children.id, childAttendanceDays.childId))
    .where(and(eq(childPickupAnnouncements.id, id), eq(children.facilityId, viewer.facilityId))).get()
  if (!found) throw new ServiceError(404, 'announcement_not_found')
  const { announcement, day } = found
  attendanceChild(db, viewer, day.childId, day.date)
  db.transaction((tx) => {
    tx.delete(childPickupAnnouncements).where(eq(childPickupAnnouncements.id, id)).run()
    const before = announcement.announcedBy === '' ? announcement.name : `${announcement.name} (${announcement.announcedBy})`
    logAttendanceChanges(tx, viewer, day.childId, day.date, [{ field: 'announcement', before, after: '' }], now)
  })
}

/**
 * Enters an absence for a day or a range (spec §3.5, at most a year; 400 invalid_range otherwise): every care day of
 * the range on which the child is active and has no stay gets it. `kind: null` clears the absences of the range.
 * 404 child_not_found when the child is active on no day of the range. Returns the number of days changed.
 */
export function setAbsence(db: Db, viewer: ChildViewer, input: AttendanceAbsenceInput, now: Date = new Date()): number {
  const span = daysBetween(input.from, input.to)
  if (span < 0 || span >= MAX_ABSENCE_DAYS) throw new ServiceError(400, 'invalid_range')
  const child = loadChild(db, viewer.facilityId, input.childId)
  const dates = dateRange(input.from, input.to).filter(date => activeOn(child, date))
  if (dates.length === 0) throw new ServiceError(404, 'child_not_found')
  const isCareDay = careDays(db, viewer.facilityId)
  const history = historyOf(db, viewer.facilityId, input.childId)
  return db.transaction((tx) => {
    let changed = 0
    for (const date of dates) {
      const existing = findDay(tx, input.childId, date)
      if (input.kind === null) {
        if (!existing || existing.absence === null) continue
      }
      else if (!isCareDay(date) || existing?.absence === input.kind || (existing && staysOf(tx, existing.id).length > 0)) {
        continue
      }
      const day = existing ?? ensureDay(tx, input.childId, date, history)
      tx.update(childAttendanceDays).set({ absence: input.kind }).where(eq(childAttendanceDays.id, day.id)).run()
      logAttendanceChanges(tx, viewer, input.childId, date, [{ field: 'absence', before: day.absence ?? '', after: input.kind ?? '' }], now)
      changed++
    }
    return changed
  })
}

/** Changes the planned pickup, brought-by, the day's note or the meal ticks (null = automatic again); left out = kept. */
export function updateDay(db: Db, viewer: ChildViewer, input: AttendanceDayInput, now: Date = new Date()): void {
  attendanceChild(db, viewer, input.childId, input.date)
  const history = historyOf(db, viewer.facilityId, input.childId)
  db.transaction((tx) => {
    const day = ensureDay(tx, input.childId, input.date, history)
    const next = {
      plannedPickup: input.plannedPickup ?? day.plannedPickup,
      broughtBy: input.broughtBy === undefined ? day.broughtBy : input.broughtBy.trim(),
      note: input.note === undefined ? day.note : input.note.trim(),
      snack: input.snack === undefined ? day.snack : input.snack,
      lunch: input.lunch === undefined ? day.lunch : input.lunch,
    }
    tx.update(childAttendanceDays).set(next).where(eq(childAttendanceDays.id, day.id)).run()
    logAttendanceChanges(tx, viewer, input.childId, input.date, [
      { field: 'plannedPickup', before: timeText(day.plannedPickup), after: timeText(next.plannedPickup) },
      { field: 'broughtBy', before: day.broughtBy, after: next.broughtBy },
      { field: 'note', before: day.note, after: next.note },
      { field: 'snack', before: flagText(day.snack), after: flagText(next.snack) },
      { field: 'lunch', before: flagText(day.lunch), after: flagText(next.lunch) },
    ], now)
  })
}

/** The stay with its day; 404 stay_not_found for an unknown one or one of another facility, child_not_found for an inactive child. */
function loadStay(db: Db, viewer: ChildViewer, stayId: number): { stay: StayRow; day: DayRow } {
  const found = db.select({ stay: childAttendanceStays, day: childAttendanceDays }).from(childAttendanceStays)
    .innerJoin(childAttendanceDays, eq(childAttendanceDays.id, childAttendanceStays.dayId))
    .innerJoin(children, eq(children.id, childAttendanceDays.childId))
    .where(and(eq(childAttendanceStays.id, stayId), eq(children.facilityId, viewer.facilityId))).get()
  if (!found) throw new ServiceError(404, 'stay_not_found')
  attendanceChild(db, viewer, found.day.childId, found.day.date)
  return found
}

/**
 * Corrects a stay (spec §3.9) by the same rules as stamping: not left before arriving (400 leave_before_arrival); a
 * stay opened again while another one of the day is open: 409 already_present. A closed stay keeps its pickup person
 * unless a new one is given (checked like leaving); closing an open stay needs one (400 pickup_person_required).
 */
export function updateStay(db: Db, viewer: ChildViewer, stayId: number, input: AttendanceStayInput, now: Date = new Date()): void {
  const { stay, day } = loadStay(db, viewer, stayId)
  if (input.left !== null && input.left < input.arrived) throw new ServiceError(400, 'leave_before_arrival')
  db.transaction((tx) => {
    let person: { name: string | null; contactId: number | null } = { name: null, contactId: null }
    if (input.left === null) {
      if (staysOf(tx, day.id).some(other => other.id !== stay.id && other.left === null)) throw new ServiceError(409, 'already_present')
    }
    else if (input.pickup) person = pickupPerson(tx, day.childId, day.id, input.pickup)
    else if (stay.left !== null && stay.pickedUpBy !== null) person = { name: stay.pickedUpBy, contactId: stay.pickedUpContactId }
    else throw new ServiceError(400, 'pickup_person_required')
    tx.update(childAttendanceStays)
      .set({ arrived: input.arrived, left: input.left, pickedUpBy: person.name, pickedUpContactId: person.contactId })
      .where(eq(childAttendanceStays.id, stay.id)).run()
    logAttendanceChanges(tx, viewer, day.childId, day.date, [
      { field: 'arrived', before: timeText(stay.arrived), after: timeText(input.arrived) },
      { field: 'left', before: timeText(stay.left), after: timeText(input.left) },
      { field: 'pickedUpBy', before: stay.pickedUpBy ?? '', after: person.name ?? '' },
    ], now)
  })
}

/** Deletes a stay that was stamped by mistake. */
export function deleteStay(db: Db, viewer: ChildViewer, stayId: number, now: Date = new Date()): void {
  const { stay, day } = loadStay(db, viewer, stayId)
  db.transaction((tx) => {
    tx.delete(childAttendanceStays).where(eq(childAttendanceStays.id, stay.id)).run()
    logAttendanceChanges(tx, viewer, day.childId, day.date, [
      { field: 'arrived', before: timeText(stay.arrived), after: '' },
      { field: 'left', before: timeText(stay.left), after: '' },
      { field: 'pickedUpBy', before: stay.pickedUpBy ?? '', after: '' },
    ], now)
  })
}
