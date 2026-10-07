import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm'
import { daysInMonth, monthDates, toIsoDate } from '../../shared/domain/dates'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import { dayNotes, monthPlans, releaseSnapshots, users } from '../db/schema'
import { FIRST_FACILITY_ID } from '../db/seed'
import { ServiceError } from '../lib/errors'
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

/** The current (draft) state of a month in the shape observers get from a release. */
export function buildSnapshot(db: Db, year: number, month: number): SnapshotData {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const staff = loadEmployees(db).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
  const staffIds = new Set(staff.map(employee => employee.id))
  // Releases are still stored for the first facility (the column default) until they are kept per facility.
  const closures = loadClosures(db, FIRST_FACILITY_ID)
  const notes = new Map(
    db.select().from(dayNotes).where(and(gte(dayNotes.date, monthStart), lte(dayNotes.date, monthEnd))).all()
      .map(note => [note.date, note]),
  )
  return {
    employees: staff.map(({ id, name, shortName }) => ({ id, name, shortName })),
    entries: loadEntries(db, { from: monthStart, to: monthEnd }).filter(entry => staffIds.has(entry.employeeId)),
    days: monthDates(year, month).map(date => ({
      date,
      info1: notes.get(date)?.info1 ?? '',
      info2: notes.get(date)?.info2 ?? '',
      closureLabel: closureOn(closures, date)?.label ?? null,
    })),
  }
}

/**
 * Releases the month as it is now. When it was released before, everyone whose own duties changed since gets a
 * message; returns the names of those employees.
 */
export function releaseMonth(db: Db, actor: SessionUser, year: number, month: number, now: Date = new Date()): { notified: string[] } {
  assertMonth(year, month)
  const releasedAt = now.toISOString()
  const snapshot = buildSnapshot(db, year, month)
  const previous = loadReleases(db, year, month).at(-1)
  return db.transaction((tx) => {
    tx.insert(releaseSnapshots).values({ year, month, releasedAt, releasedBy: actor.id, data: JSON.stringify(snapshot) }).run()
    tx.insert(monthPlans).values({ year, month, releasedAt, releasedBy: actor.id })
      .onConflictDoUpdate({ target: [monthPlans.facilityId, monthPlans.year, monthPlans.month], set: { releasedAt, releasedBy: actor.id } })
      .run()
    if (!previous) return { notified: [] }
    const told = new Set(notifyDutyChanges(tx, year, month, previous.data, snapshot, releasedAt))
    return { notified: snapshot.employees.filter(employee => told.has(employee.id)).map(employee => employee.name) }
  })
}

export function loadReleases(db: Db, year: number, month: number): StoredRelease[] {
  return db.select({ snapshot: releaseSnapshots, username: users.username })
    .from(releaseSnapshots)
    .leftJoin(users, eq(releaseSnapshots.releasedBy, users.id))
    .where(and(eq(releaseSnapshots.year, year), eq(releaseSnapshots.month, month)))
    .orderBy(asc(releaseSnapshots.releasedAt), asc(releaseSnapshots.id))
    .all()
    .map(({ snapshot, username }) => ({
      releasedAt: snapshot.releasedAt,
      releasedBy: username ?? '',
      data: JSON.parse(snapshot.data) as SnapshotData,
    }))
}

/** Gives months released before snapshots existed a first snapshot built from their current state. */
export function backfillSnapshots(db: Db): number {
  let created = 0
  for (const plan of db.select().from(monthPlans).where(isNotNull(monthPlans.releasedAt)).all()) {
    const existing = db.select({ id: releaseSnapshots.id }).from(releaseSnapshots)
      .where(and(eq(releaseSnapshots.year, plan.year), eq(releaseSnapshots.month, plan.month))).get()
    if (existing) continue
    db.insert(releaseSnapshots).values({
      year: plan.year, month: plan.month, releasedAt: plan.releasedAt!, releasedBy: plan.releasedBy,
      data: JSON.stringify(buildSnapshot(db, plan.year, plan.month)),
    }).run()
    created++
  }
  return created
}
