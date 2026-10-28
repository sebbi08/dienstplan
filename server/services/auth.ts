import { eq } from 'drizzle-orm'
import { todayIso } from '../../shared/domain/dates'
import type { IsoDate } from '../../shared/domain/types'
import type { SessionPayloadUser, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../lib/password'
import { normalizeUsername } from '../lib/username'
import { resolveFacilityId } from './facilities'
import { accountRights } from './permissions'

export const MAX_FAILED_LOGINS = 5
export const LOCK_MINUTES = 15

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; reason: 'invalid' | 'locked' | 'left' }

/** The account as the server works with it: facility, permissions and their scopes resolved fresh from the database. */
export function toSessionUser(db: Db, row: typeof users.$inferSelect): SessionUser {
  const user = {
    id: row.id, username: row.username, role: row.role,
    employeeId: row.employeeId, mustChangePassword: row.mustChangePassword,
    facilityId: resolveFacilityId(db, row),
  }
  const rights = accountRights(db, user)
  return { ...user, permissions: rights.permissions, scopes: rights.scopes }
}

/** The user as the session cookie stores it and the browser gets it: the permission set and scopes stay on the server. */
export function sessionPayload(user: SessionUser): SessionPayloadUser {
  const { permissions: _permissions, scopes: _scopes, ...payload } = user
  return payload
}

/**
 * Whether the account belongs to a Leitung or Mitarbeiter whose employee has left (from the day after leaving, in
 * Berlin). Such an account can no longer sign in or keep a session until the Träger deletes it with the employee's
 * „Persönliche Daten“; taking the leaving back (or moving it to a later day) makes it work again. The Träger is never
 * blocked.
 */
function hasLeft(db: Db, row: typeof users.$inferSelect, today: IsoDate): boolean {
  if ((row.role !== 'admin' && row.role !== 'observer') || row.employeeId === null) return false
  const employee = db.select({ leftOn: employees.leftOn }).from(employees).where(eq(employees.id, row.employeeId)).get()
  return employee?.leftOn != null && employee.leftOn < today
}

export function login(db: Db, username: string, password: string, now: Date = new Date()): LoginResult {
  const user = db.select().from(users).where(eq(users.username, normalizeUsername(username))).get()
  if (!user || !user.active) return { ok: false, reason: 'invalid' }
  if (user.lockedUntil && user.lockedUntil > now.toISOString()) return { ok: false, reason: 'locked' }

  if (!verifyPassword(password, user.passwordHash)) {
    const failed = user.failedLogins + 1
    if (failed >= MAX_FAILED_LOGINS) {
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString()
      db.update(users).set({ failedLogins: 0, lockedUntil }).where(eq(users.id, user.id)).run()
      return { ok: false, reason: 'locked' }
    }
    db.update(users).set({ failedLogins: failed }).where(eq(users.id, user.id)).run()
    return { ok: false, reason: 'invalid' }
  }

  db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id)).run()
  // Only after the right password, so the answer tells nothing to someone who does not know it.
  if (hasLeft(db, user, todayIso(now))) return { ok: false, reason: 'left' }
  return { ok: true, user: toSessionUser(db, user) }
}

/** The account behind a session; null when it is gone, deactivated or belongs to someone who has left (see hasLeft). */
export function getActiveUser(db: Db, id: number, today: IsoDate = todayIso()): SessionUser | null {
  const row = db.select().from(users).where(eq(users.id, id)).get()
  return row && row.active && !hasLeft(db, row, today) ? toSessionUser(db, row) : null
}

export function assertPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new ServiceError(400, 'password_too_short')
}

export function changePassword(db: Db, userId: number, currentPassword: string, newPassword: string): void {
  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) throw new ServiceError(404, 'user_not_found')
  if (!verifyPassword(currentPassword, user.passwordHash)) throw new ServiceError(400, 'wrong_password')
  assertPasswordStrength(newPassword)
  db.update(users)
    .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false })
    .where(eq(users.id, userId)).run()
}
