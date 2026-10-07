import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import { parseCellKey } from '../../shared/domain/cells'
import { addDays } from '../../shared/domain/dates'
import { diffCells, snapshotCells } from '../../shared/domain/releaseDiff'
import type { IsoDate } from '../../shared/domain/types'
import type { DutyChangeDto, NotificationDto, ReleaseNotificationStatusDto, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, monthPlans, notifications, users } from '../db/schema'

/** Read messages stay visible this many days. */
const KEEP_READ_DAYS = 14

/**
 * After a month is released again: every employee whose own cells differ from the previous release gets one message
 * listing the changes. Day notes (Info 1/2) are not personal and are left out. Only the facility's employees are told.
 * Returns the ids of the employees told.
 */
export function notifyDutyChanges(
  db: Db, facilityId: number, year: number, month: number, previous: SnapshotData, next: SnapshotData, releasedAt: string,
): number[] {
  const byEmployee = new Map<number, DutyChangeDto[]>()
  for (const diff of diffCells(snapshotCells(previous), snapshotCells(next))) {
    const { employeeId, date } = parseCellKey(diff.key)
    if (!Number.isInteger(employeeId)) continue // an Info field, not a person
    byEmployee.set(employeeId, [...(byEmployee.get(employeeId) ?? []), { date, before: diff.before, after: diff.after }])
  }
  const existing = new Set(db.select({ id: employees.id }).from(employees).where(eq(employees.facilityId, facilityId)).all()
    .map(row => row.id))
  const told = [...byEmployee.keys()].filter(id => existing.has(id))
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

/** For the Leitung: who of the facility got a message from its latest release of the month, and who has read it. */
export function releaseNotificationStatus(db: Db, facilityId: number, year: number, month: number): ReleaseNotificationStatusDto[] {
  const plan = db.select().from(monthPlans)
    .where(and(eq(monthPlans.facilityId, facilityId), eq(monthPlans.year, year), eq(monthPlans.month, month))).get()
  if (!plan?.releasedAt) return []
  const linked = new Set(db.select({ employeeId: users.employeeId }).from(users).where(eq(users.active, true)).all()
    .map(row => row.employeeId))
  return db.select({ notification: notifications, name: employees.name })
    .from(notifications).innerJoin(employees, eq(notifications.employeeId, employees.id))
    .where(and(
      eq(employees.facilityId, facilityId), eq(notifications.year, year), eq(notifications.month, month),
      eq(notifications.createdAt, plan.releasedAt),
    ))
    .orderBy(employees.sortOrder).all()
    .map(({ notification, name }) => ({
      employeeId: notification.employeeId, name, readAt: notification.readAt, hasAccount: linked.has(notification.employeeId),
    }))
}
