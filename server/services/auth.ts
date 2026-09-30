import { eq } from 'drizzle-orm'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../lib/password'
import { normalizeUsername } from '../lib/username'

export const MAX_FAILED_LOGINS = 5
export const LOCK_MINUTES = 15

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; reason: 'invalid' | 'locked' }

export function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id, username: row.username, role: row.role,
    employeeId: row.employeeId, mustChangePassword: row.mustChangePassword,
  }
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
  return { ok: true, user: toSessionUser(user) }
}

export function getActiveUser(db: Db, id: number): SessionUser | null {
  const row = db.select().from(users).where(eq(users.id, id)).get()
  return row && row.active ? toSessionUser(row) : null
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
