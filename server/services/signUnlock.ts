import { randomBytes } from 'node:crypto'
import { and, eq, lt, or } from 'drizzle-orm'
import { SIGN_UNLOCK_IDLE_MS, SIGN_UNLOCK_MAX_MS, signUnlockValid } from '../../shared/domain/signRequests'
import type { Db } from '../db/client'
import { signUnlocks } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { terminalStatus, verifyEmployeePin } from './terminal'

/**
 * „Zu unterschreiben“ at the facility's tablet: a person of its list enters their PIN (the same attempts and lock as
 * stamping) and the tablet shows their requests to sign – nothing else. This unlock is its own (sign_unlocks), apart from
 * the child records' one: it never opens a child record, and a child unlock never signs. It is short: it ends 3 minutes
 * after the last use and 10 minutes after the PIN at the latest, also inside the facility's windows without the
 * automatic lock (shared/domain/signRequests.ts). One per tablet: a new PIN ends the previous one.
 */

type Terminal = { id: number; facilityId: number }

/** Who signs at the tablet: the person who entered the PIN; no account is named (the employee's own, if any, uploads). */
export interface TabletSigner {
  employeeId: number
  userId: null
  /** The tablet's facility: only its requests are shown and signed there. */
  facilityId: number
}

/** Deletes the sign unlocks that ran out (of every tablet). */
function deleteExpired(db: Db, now: Date): void {
  const idle = new Date(now.getTime() - SIGN_UNLOCK_IDLE_MS).toISOString()
  const max = new Date(now.getTime() - SIGN_UNLOCK_MAX_MS).toISOString()
  db.delete(signUnlocks).where(or(lt(signUnlocks.lastActiveAt, idle), lt(signUnlocks.createdAt, max))).run()
}

/**
 * Unlocks the tablet for signing for a person of its list (404 employee_not_found otherwise, without counting a PIN
 * attempt) who knows their PIN. Answers the token for the tablet's session.
 */
export function unlockForSigning(db: Db, terminal: Terminal, employeeId: number, pin: string, now: Date = new Date()): string {
  if (!terminalStatus(db, terminal.facilityId, now).some(person => person.employeeId === employeeId)) {
    throw new ServiceError(404, 'employee_not_found')
  }
  verifyEmployeePin(db, employeeId, pin, now)
  const token = randomBytes(32).toString('base64url')
  const stamp = now.toISOString()
  db.transaction((tx) => {
    deleteExpired(tx, now)
    tx.delete(signUnlocks).where(eq(signUnlocks.terminalUserId, terminal.id)).run()
    tx.insert(signUnlocks).values({ id: token, terminalUserId: terminal.id, facilityId: terminal.facilityId, employeeId, createdAt: stamp, lastActiveAt: stamp }).run()
  })
  return token
}

/** Ends the tablet's sign unlock the token stands for (only that one). */
export function lockSigning(db: Db, terminalUserId: number, token: string | undefined): void {
  if (!token) return
  db.delete(signUnlocks).where(and(eq(signUnlocks.terminalUserId, terminalUserId), eq(signUnlocks.id, token))).run()
}

/**
 * The person signing at this tablet (403 sign_locked without a valid sign unlock: none, another tablet's or facility's,
 * run out, or the person no longer on the tablet's list – PIN cleared, left, help day over; then it is deleted, as for
 * the child records). Each request counts as use.
 */
export function tabletSigner(db: Db, terminal: Terminal, token: string | undefined, now: Date = new Date()): TabletSigner {
  const row = token ? db.select().from(signUnlocks).where(eq(signUnlocks.id, token)).get() : undefined
  if (!row || row.terminalUserId !== terminal.id || row.facilityId !== terminal.facilityId) throw new ServiceError(403, 'sign_locked')
  if (!signUnlockValid(row.createdAt, row.lastActiveAt, now)
    || !terminalStatus(db, terminal.facilityId, now).some(person => person.employeeId === row.employeeId)) {
    db.delete(signUnlocks).where(eq(signUnlocks.id, row.id)).run()
    throw new ServiceError(403, 'sign_locked')
  }
  db.update(signUnlocks).set({ lastActiveAt: now.toISOString() }).where(eq(signUnlocks.id, row.id)).run()
  return { employeeId: row.employeeId, userId: null, facilityId: terminal.facilityId }
}
