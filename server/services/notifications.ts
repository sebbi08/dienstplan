import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import { parseCellKey } from '../../shared/domain/cells'
import { addDays } from '../../shared/domain/dates'
import { diffCells, ownEntries, snapshotCells } from '../../shared/domain/releaseDiff'
import type { IsoDate } from '../../shared/domain/types'
import type { DutyChangeDto, NotificationDto, ReleaseNotificationStatusDto, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, monthPlans, notifications, releaseSnapshots, users } from '../db/schema'
import { groupNames } from './groups'
import { ownCellFilter } from './queries'

/** Read messages stay visible this many days. */
const KEEP_READ_DAYS = 14

/**
 * After a month is released again: every employee whose own cells differ from the previous release gets one message
 * listing the changes. Day notes (Info 1/2) are not personal and are left out. Only the people of the facility's own cells
 * are told: its staff, and its helpers about the duties planned here.
 * Returns the ids of the employees told.
 */
export function notifyDutyChanges(
  db: Db, facilityId: number, year: number, month: number, previous: SnapshotData, next: SnapshotData, releasedAt: string,
): number[] {
  // Only the facility's own cells: its staff, and someone who moved in only from that day on (their earlier duties
  // entering this plan are no change).
  const ownsCell = ownCellFilter(db, facilityId)
  // Help-elsewhere markers are another plan's cells: that plan tells the person about them, this one does not.
  const names = groupNames(db, facilityId)
  const own = (data: SnapshotData) => snapshotCells({ ...data, entries: ownEntries(facilityId, data.entries) }, names)
  const byEmployee = new Map<number, DutyChangeDto[]>()
  for (const diff of diffCells(own(previous), own(next))) {
    const { employeeId, date } = parseCellKey(diff.key)
    if (!Number.isInteger(employeeId)) continue // an Info field, not a person
    if (!ownsCell(employeeId, date)) continue
    byEmployee.set(employeeId, [...(byEmployee.get(employeeId) ?? []), { date, before: diff.before, after: diff.after }])
  }
  const told = [...byEmployee.keys()]
  for (const employeeId of told) {
    db.insert(notifications).values({
      employeeId, year, month, createdAt: releasedAt, changes: JSON.stringify(byEmployee.get(employeeId)),
    }).run()
  }
  return told
}

function toDto(row: typeof notifications.$inferSelect): NotificationDto {
  return {
    id: row.id, year: row.year, month: row.month, createdAt: row.createdAt, readAt: row.readAt,
    changes: JSON.parse(row.changes) as DutyChangeDto[],
  }
}

/** The employee's unread messages and those read within the last KEEP_READ_DAYS days, newest first. */
export function listNotifications(db: Db, employeeId: number, now: Date = new Date()): NotificationDto[] {
  const keepFrom = addDays(now.toISOString().slice(0, 10) as IsoDate, -KEEP_READ_DAYS)
  return db.select().from(notifications)
    .where(and(eq(notifications.employeeId, employeeId), or(isNull(notifications.readAt), gte(notifications.readAt, keepFrom))))
    .orderBy(desc(notifications.createdAt), desc(notifications.id)).all()
    .map(toDto)
}

/** Marks the given messages of this employee as read (others' ids are ignored). */
export function markNotificationsRead(db: Db, employeeId: number, ids: number[], now: Date = new Date()): void {
  if (ids.length === 0) return
  db.update(notifications).set({ readAt: now.toISOString() })
    .where(and(eq(notifications.employeeId, employeeId), inArray(notifications.id, ids), isNull(notifications.readAt))).run()
}

/**
 * For the Leitung: who of the facility got a message from its latest release of the month, and who has read it: its
 * staff, then the month's helpers (the people of that release with helpFrom).
 */
export function releaseNotificationStatus(db: Db, facilityId: number, year: number, month: number): ReleaseNotificationStatusDto[] {
  const plan = db.select().from(monthPlans)
    .where(and(eq(monthPlans.facilityId, facilityId), eq(monthPlans.year, year), eq(monthPlans.month, month))).get()
  if (!plan?.releasedAt) return []
  const snapshot = db.select({ data: releaseSnapshots.data }).from(releaseSnapshots).where(and(
    eq(releaseSnapshots.facilityId, facilityId), eq(releaseSnapshots.year, year), eq(releaseSnapshots.month, month),
    eq(releaseSnapshots.releasedAt, plan.releasedAt),
  )).orderBy(desc(releaseSnapshots.id)).limit(1).get()
  const helperIds = snapshot
    ? (JSON.parse(snapshot.data) as SnapshotData).employees.filter(employee => employee.helpFrom != null).map(employee => employee.id)
    : []
  const linked = new Set(db.select({ employeeId: users.employeeId }).from(users).where(eq(users.active, true)).all()
    .map(row => row.employeeId))
  return db.select({ notification: notifications, name: employees.name, homeFacilityId: employees.facilityId })
    .from(notifications).innerJoin(employees, eq(notifications.employeeId, employees.id))
    .where(and(
      helperIds.length === 0
        ? eq(employees.facilityId, facilityId)
        : or(eq(employees.facilityId, facilityId), inArray(employees.id, helperIds)),
      eq(notifications.year, year), eq(notifications.month, month), eq(notifications.createdAt, plan.releasedAt),
    ))
    .orderBy(employees.sortOrder).all()
    // Staff first, then the helpers (as in the plan).
    .sort((a, b) => Number(a.homeFacilityId !== facilityId) - Number(b.homeFacilityId !== facilityId))
    .map(({ notification, name }) => ({
      employeeId: notification.employeeId, name, readAt: notification.readAt, hasAccount: linked.has(notification.employeeId),
    }))
}
