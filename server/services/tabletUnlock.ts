import { randomBytes } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { isManager, mayEditChildren } from '../../shared/domain/roles'
import { UNLOCK_GRACE_SECONDS } from '../../shared/domain/tablet'
import type {
  ChildRightsDto, SessionUser, TabletSettingsDto, TabletUnlockStatusDto, TerminalPersonDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilities, terminalUnlocks, users } from '../db/schema'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { getTabletSettings } from './tabletSettings'
import { terminalStatus, verifyEmployeePin } from './terminal'

type UnlockRow = typeof terminalUnlocks.$inferSelect
type Terminal = { id: number; facilityId: number }
type Resolved =
  | { unlocked: false; dropped?: UnlockRow }
  | { unlocked: true; row: UnlockRow; person: TerminalPersonDto; settings: TabletSettingsDto; viewer: ChildViewer }

/** The moment after which the server no longer accepts an unlock that was last used at lastActiveAt. */
function validUntil(lastActiveAt: string, lockMinutes: number): number {
  return Date.parse(lastActiveAt) + (lockMinutes * 60 + UNLOCK_GRACE_SECONDS) * 1000
}

/**
 * The rights of the person who unlocked, as they are now (spec §4.1): home staff with an active linked account have the
 * rights of that account; everyone else (no or deactivated account, helpers) can only read.
 */
function viewerFor(db: Db, terminal: Terminal, employeeId: number, settings: TabletSettingsDto): ChildViewer {
  const employee = db.select({ facilityId: employees.facilityId, name: employees.name }).from(employees)
    .where(eq(employees.id, employeeId)).get()
  const account = employee?.facilityId === terminal.facilityId
    ? db.select().from(users).where(and(eq(users.employeeId, employeeId), eq(users.active, true))).get()
    : undefined
  const role = account?.role ?? 'observer'
  return {
    id: account?.id ?? null,
    employeeId,
    name: employee?.name ?? '',
    role,
    canEditChildren: account?.canEditChildren ?? false,
    facilityId: terminal.facilityId,
    visibility: isManager(role) ? null : { waitlist: settings.showWaitlist, futureContracts: settings.showFutureContracts },
    onTablet: true,
  }
}

/** Looks at the unlock the token stands for; never writes. A person who dropped off the tablet list is reported as dropped. */
function resolveUnlock(db: Db, terminal: Terminal, token: string | undefined, now: Date): Resolved {
  const row = token ? db.select().from(terminalUnlocks).where(eq(terminalUnlocks.id, token)).get() : undefined
  if (!row || row.terminalUserId !== terminal.id || row.facilityId !== terminal.facilityId) return { unlocked: false }
  const settings = getTabletSettings(db, terminal.facilityId)
  if (now.getTime() > validUntil(row.lastActiveAt, settings.lockMinutes)) return { unlocked: false }
  const person = terminalStatus(db, terminal.facilityId, now).find(candidate => candidate.employeeId === row.employeeId)
  if (!person) return { unlocked: false, dropped: row }
  return { unlocked: true, row, person, settings, viewer: viewerFor(db, terminal, row.employeeId, settings) }
}

function rightsOf(viewer: ChildViewer): ChildRightsDto {
  return {
    canEdit: mayEditChildren(viewer),
    isManager: isManager(viewer.role),
    canMoveFacility: false,
    showWaitlist: viewer.visibility?.waitlist ?? true,
    showFutureContracts: viewer.visibility?.futureContracts ?? true,
  }
}

function statusOf(resolved: Resolved): TabletUnlockStatusDto {
  if (!resolved.unlocked) return { unlocked: false }
  return {
    unlocked: true, employeeId: resolved.person.employeeId, name: resolved.person.name,
    rights: rightsOf(resolved.viewer), lockMinutes: resolved.settings.lockMinutes,
  }
}

/**
 * Unlocks the child records at the tablet for a person of its list (404 employee_not_found otherwise, without counting
 * a PIN attempt) who knows their PIN (the same attempts and lock as stamping). Ends every earlier unlock of this tablet and
 * deletes the expired ones of all tablets. The token belongs in the tablet's session; the row is what counts.
 */
export function unlockChildren(
  db: Db, terminal: Terminal, employeeId: number, pin: string, now: Date = new Date(),
): { token: string; status: TabletUnlockStatusDto } {
  if (!terminalStatus(db, terminal.facilityId, now).some(person => person.employeeId === employeeId)) {
    throw new ServiceError(404, 'employee_not_found')
  }
  verifyEmployeePin(db, employeeId, pin, now)
  const token = randomBytes(32).toString('base64url')
  db.transaction((tx) => {
    deleteExpiredUnlocks(tx, now)
    tx.delete(terminalUnlocks).where(eq(terminalUnlocks.terminalUserId, terminal.id)).run()
    const stamp = now.toISOString()
    tx.insert(terminalUnlocks)
      .values({ id: token, terminalUserId: terminal.id, facilityId: terminal.facilityId, employeeId, createdAt: stamp, lastActiveAt: stamp })
      .run()
  })
  return { token, status: statusOf(resolveUnlock(db, terminal, token, now)) }
}

/**
 * Ends the tablet's unlock the token stands for. Only that one: a device whose unlock was already replaced (another
 * device with the same account unlocked since) goes back to its start page and locks there, which must not end the
 * other device's unlock. Without a token nothing is unlocked, so nothing is deleted.
 */
export function lockChildren(db: Db, terminalUserId: number, token: string | undefined): void {
  if (!token) return
  db.delete(terminalUnlocks).where(and(eq(terminalUnlocks.terminalUserId, terminalUserId), eq(terminalUnlocks.id, token))).run()
}

/**
 * Who is looking at the child records at this tablet, with their rights as they are now. 403 tablet_locked without a
 * valid unlock: no row for the token, a row of another tablet or facility, the lock time plus grace over, or the person
 * no longer on the tablet list (PIN cleared, left, no longer planned here) - then the row is deleted. `touch` counts the
 * request as use of the tablet and keeps it unlocked.
 */
export function tabletChildViewer(
  db: Db, terminal: Terminal, token: string | undefined, now: Date = new Date(), touch = true,
): ChildViewer {
  const resolved = resolveUnlock(db, terminal, token, now)
  if (!resolved.unlocked) {
    if (resolved.dropped) lockChildren(db, resolved.dropped.terminalUserId, resolved.dropped.id)
    throw new ServiceError(403, 'tablet_locked')
  }
  if (touch) db.update(terminalUnlocks).set({ lastActiveAt: now.toISOString() }).where(eq(terminalUnlocks.id, resolved.row.id)).run()
  return resolved.viewer
}

/**
 * Who looks at child records with this request (spec §4, §8.2): the tablet only through a valid unlock (403
 * tablet_locked otherwise; the request counts as use), Leitung and Träger with their own account in their facility (403
 * no_facility without one). Every other account, Mitarbeiter with or without the edit flag, sees no child data at all:
 * 403 children_tablet_only.
 */
export function resolveChildViewer(db: Db, user: SessionUser, token: string | undefined, now: Date = new Date()): ChildViewer {
  if (user.role === 'terminal') {
    if (user.facilityId === null) throw new ServiceError(403, 'no_facility')
    return tabletChildViewer(db, { id: user.id, facilityId: user.facilityId }, token, now, true)
  }
  if (!isManager(user.role)) throw new ServiceError(403, 'children_tablet_only')
  if (user.facilityId === null) throw new ServiceError(403, 'no_facility')
  const employee = user.employeeId === null ? undefined
    : db.select({ name: employees.name }).from(employees).where(eq(employees.id, user.employeeId)).get()
  return {
    id: user.id, employeeId: user.employeeId, name: employee?.name ?? user.username, role: user.role,
    canEditChildren: user.canEditChildren, facilityId: user.facilityId, visibility: null, onTablet: false,
  }
}

/** Like tabletChildViewer, but answers { unlocked: false } instead of throwing and changes nothing. */
export function tabletUnlockStatus(db: Db, terminal: Terminal, token: string | undefined, now: Date = new Date()): TabletUnlockStatusDto {
  return statusOf(resolveUnlock(db, terminal, token, now))
}

/** Deletes the unlocks no tablet would accept any more, whichever facility; returns how many. */
export function deleteExpiredUnlocks(db: Db, now: Date): number {
  const lockMinutes = new Map(db.select({ id: facilities.id, minutes: facilities.tabletLockMinutes }).from(facilities).all()
    .map(facility => [facility.id, facility.minutes]))
  const expired = db.select().from(terminalUnlocks).all()
    .filter(row => now.getTime() > validUntil(row.lastActiveAt, lockMinutes.get(row.facilityId) ?? 0))
    .map(row => row.id)
  if (expired.length > 0) db.delete(terminalUnlocks).where(inArray(terminalUnlocks.id, expired)).run()
  return expired.length
}
