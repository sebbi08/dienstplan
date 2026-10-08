import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm'
import { daysInMonth, monthDates, toIsoDate } from '../../shared/domain/dates'
import { describeEntry } from '../../shared/domain/describe'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { EntryDto, SessionUser, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import { dayNotes, monthPlans, releaseSnapshots, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { listHelpers } from './helpOuts'
import { notifyDutyChanges } from './notifications'
import { closureOn, loadClosures, loadEmployees, loadEntries } from './queries'

export interface StoredRelease {
  releasedAt: string
  releasedBy: string
  data: SnapshotData
}

function assertMonth(year: number, month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ServiceError(400, 'invalid_month')
  }
}

/**
 * A facility's view of its staff's entries: an entry planned in another facility (a help-elsewhere marker) keeps only
 * when the person works there, without that plan's note, shift template, shift name or group.
 */
export function withPlainMarkers(facilityId: number, list: EntryDto[]): EntryDto[] {
  return list.map(entry => entry.helpFacilityId === null || entry.helpFacilityId === facilityId
    ? entry
    : { ...entry, templateId: null, note: null, label: describeEntry(entry, null), shortLabel: null, color: 'neutral', groupId: null })
}

/**
 * The current (draft) state of a facility's month in the shape observers get from a release: the own staff (with all
 * their entries, so their help-outs elsewhere show as plain markers), then the month's helpers with only the entries
 * planned here.
 */
export function buildSnapshot(db: Db, facilityId: number, year: number, month: number): SnapshotData {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const staff = loadEmployees(db, facilityId).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
  const helpers = listHelpers(db, facilityId, year, month)
  const staffIds = new Set(staff.map(employee => employee.id))
  const helperIds = new Set(helpers.map(helper => helper.employeeId))
  const employeeIds = [...staffIds, ...helperIds]
  const closures = loadClosures(db, facilityId)
  const notes = new Map(
    db.select().from(dayNotes)
      .where(and(eq(dayNotes.facilityId, facilityId), gte(dayNotes.date, monthStart), lte(dayNotes.date, monthEnd))).all()
      .map(note => [note.date, note]),
  )
  return {
    employees: [
      ...staff.map(({ id, name, shortName }) => ({ id, name, shortName, helpFrom: null })),
      ...helpers.map(helper => ({ id: helper.employeeId, name: helper.name, shortName: helper.shortName, helpFrom: helper.fromFacility })),
    ],
    entries: employeeIds.length === 0
      ? []
      : withPlainMarkers(facilityId, loadEntries(db, { from: monthStart, to: monthEnd, employeeIds })
          .filter(entry => staffIds.has(entry.employeeId) || (helperIds.has(entry.employeeId) && entry.helpFacilityId === facilityId))),
    days: monthDates(year, month).map(date => ({
      date,
      info1: notes.get(date)?.info1 ?? '',
      info2: notes.get(date)?.info2 ?? '',
      closureLabel: closureOn(closures, date)?.label ?? null,
    })),
  }
}

/**
 * Releases the facility's month as it is now. When it was released before, everyone whose own duties changed since
 * gets a message; returns the names of those employees.
 */
export function releaseMonth(
  db: Db, actor: SessionUser, facilityId: number, year: number, month: number, now: Date = new Date(),
): { notified: string[] } {
  assertMonth(year, month)
  const releasedAt = now.toISOString()
  const snapshot = buildSnapshot(db, facilityId, year, month)
  const previous = loadReleases(db, facilityId, year, month).at(-1)
  return db.transaction((tx) => {
    tx.insert(releaseSnapshots).values({ facilityId, year, month, releasedAt, releasedBy: actor.id, data: JSON.stringify(snapshot) }).run()
    tx.insert(monthPlans).values({ facilityId, year, month, releasedAt, releasedBy: actor.id })
      .onConflictDoUpdate({ target: [monthPlans.facilityId, monthPlans.year, monthPlans.month], set: { releasedAt, releasedBy: actor.id } })
      .run()
    if (!previous) return { notified: [] }
    const told = new Set(notifyDutyChanges(tx, facilityId, year, month, previous.data, snapshot, releasedAt))
    return { notified: snapshot.employees.filter(employee => told.has(employee.id)).map(employee => employee.name) }
  })
}

export function loadReleases(db: Db, facilityId: number, year: number, month: number): StoredRelease[] {
  return db.select({ snapshot: releaseSnapshots, username: users.username })
    .from(releaseSnapshots)
    .leftJoin(users, eq(releaseSnapshots.releasedBy, users.id))
    .where(and(eq(releaseSnapshots.facilityId, facilityId), eq(releaseSnapshots.year, year), eq(releaseSnapshots.month, month)))
    .orderBy(asc(releaseSnapshots.releasedAt), asc(releaseSnapshots.id))
    .all()
    .map(({ snapshot, username }) => ({
      releasedAt: snapshot.releasedAt,
      releasedBy: username ?? '',
      data: readSnapshot(facilityId, snapshot.data),
    }))
}

/**
 * Parses stored snapshot JSON; snapshots from before help-outs have no helpFrom / helpFacilityId, and snapshots from
 * before groups no entry groupId, which read as null. Markers are shown plain even if a stored snapshot has more of the
 * other plan.
 */
function readSnapshot(facilityId: number, json: string): SnapshotData {
  const data = JSON.parse(json) as SnapshotData
  return {
    ...data,
    employees: data.employees.map(employee => ({ ...employee, helpFrom: employee.helpFrom ?? null })),
    entries: withPlainMarkers(facilityId, data.entries.map(entry => ({
      ...entry, helpFacilityId: entry.helpFacilityId ?? null, groupId: entry.groupId ?? null,
    }))),
  }
}

/** Gives months released before snapshots existed a first snapshot built from their current state, per facility. */
export function backfillSnapshots(db: Db): number {
  let created = 0
  for (const plan of db.select().from(monthPlans).where(isNotNull(monthPlans.releasedAt)).all()) {
    const existing = db.select({ id: releaseSnapshots.id }).from(releaseSnapshots)
      .where(and(
        eq(releaseSnapshots.facilityId, plan.facilityId), eq(releaseSnapshots.year, plan.year), eq(releaseSnapshots.month, plan.month),
      )).get()
    if (existing) continue
    db.insert(releaseSnapshots).values({
      facilityId: plan.facilityId, year: plan.year, month: plan.month, releasedAt: plan.releasedAt!, releasedBy: plan.releasedBy,
      data: JSON.stringify(buildSnapshot(db, plan.facilityId, plan.year, plan.month)),
    }).run()
    created++
  }
  return created
}
