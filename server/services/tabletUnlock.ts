import { randomBytes } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { effectiveRights, type BundleScope } from '../../shared/domain/permissionBundles'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { UNLOCK_GRACE_SECONDS } from '../../shared/domain/tablet'
import type {
  ChildRightsDto, GroupAccess, SessionUser, TabletSettingsDto, TabletUnlockStatusDto, TerminalPersonDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilities, terminalUnlocks, users } from '../db/schema'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { readableGroupIds } from './groupReadAccess'
import { accountRights, roleBundleRows } from './permissions'
import { getTabletSettings } from './tabletSettings'
import { terminalStatus, verifyEmployeePin } from './terminal'

type UnlockRow = typeof terminalUnlocks.$inferSelect
type Terminal = { id: number; facilityId: number }
type Resolved =
  | { unlocked: false; dropped?: UnlockRow }
  | { unlocked: true; row: UnlockRow; person: TerminalPersonDto; settings: TabletSettingsDto; viewer: ChildViewer }

/**
 * A person without (active) account of the home facility at the tablet: the current Mitarbeiter role settings (else the
 * defaults), no exceptions. Read per request, so a change of the role reaches them at once (spec §6).
 */
function noAccountRights(db: Db) {
  return effectiveRights({ role: 'observer', roleBundles: roleBundleRows(db, 'observer') })
}

type GroupScopes = Pick<ChildViewer, 'groups' | 'writeGroups'>

/**
 * The groups a person of the facility works with, per child switch (see `groupRightOf`): „ansehen“ decides which groups
 * they see, „Anwesenheit und Gruppenbuch“ and „eintragen und Akten ändern“ where they write. Scope „nur eigene Gruppe“:
 * the own group (and, to see, the groups it may read); „ganze Einrichtung“, or no home group: every group. A switch
 * they do not hold follows „ansehen“ (its key is refused anyway).
 */
function groupAccessFor(db: Db, scopes: ReadonlyMap<PermissionKey, BundleScope> | undefined, groupId: number | null): GroupScopes {
  if (groupId === null) return { groups: null, writeGroups: { attendance: null, edit: null } }
  let own: GroupAccess | undefined
  // No facility check here: the employee's group is one of the home facility, and a stray one must not break the tablet.
  const restricted = () => (own ??= { own: groupId, readable: readableGroupIds(db, groupId) })
  const view = scopes?.get('children.view') === 'group' ? restricted() : null
  const of = (key: PermissionKey) => {
    const scope = scopes?.get(key)
    return scope === undefined ? view : scope === 'group' ? restricted() : null
  }
  return { groups: view, writeGroups: { attendance: of('children.attendance'), edit: of('children.edit') } }
}

/**
 * Which planned children the viewer sees, at the tablet and with the own account alike: whoever holds children.planned
 * (in „Kinder: verwalten“) every one; everyone else as the facility's tablet switches say (Vormerkungen, future contracts).
 */
function visibilityFor(permissions: ReadonlySet<PermissionKey>, settings: TabletSettingsDto): ChildViewer['visibility'] {
  return can(permissions, 'children.planned') ? null
    : { waitlist: settings.showWaitlist, futureContracts: settings.showFutureContracts }
}

/** Every group, for a viewer without a home group of the facility (helpers, the Träger, staff without group). */
const ALL_GROUPS: GroupScopes = { groups: null, writeGroups: { attendance: null, edit: null } }

/** The moment after which the server no longer accepts an unlock that was last used at lastActiveAt. */
function validUntil(lastActiveAt: string, lockMinutes: number): number {
  return Date.parse(lastActiveAt) + (lockMinutes * 60 + UNLOCK_GRACE_SECONDS) * 1000
}

/**
 * The rights of the person who unlocked, as they are now (spec §4.1): home staff with an active linked account have the
 * permissions of that account (role settings and exceptions); everyone else (no or deactivated account, helpers) has
 * the current Mitarbeiter role settings without exceptions, so reads and keeps the attendance, but changes no record. Home staff
 * whose child switches have the scope „nur eigene Gruppe“ work with their own group and the groups it may read (group
 * book spec §3.1); with „ganze Einrichtung“, helpers and staff without a home group with every group (ruling: no home
 * group = all groups). Without children.planned the tablet switches decide which planned children are shown.
 */
function viewerFor(db: Db, terminal: Terminal, employeeId: number, settings: TabletSettingsDto): ChildViewer {
  const employee = db.select({ facilityId: employees.facilityId, name: employees.name, groupId: employees.groupId })
    .from(employees).where(eq(employees.id, employeeId)).get()
  const homeStaff = employee?.facilityId === terminal.facilityId
  const account = homeStaff
    ? db.select().from(users).where(and(eq(users.employeeId, employeeId), eq(users.active, true))).get()
    : undefined
  const role = account?.role ?? 'observer'
  // One read of the rights gives both the permissions and the scope.
  const rights = account ? accountRights(db, { id: account.id, role: account.role, facilityId: terminal.facilityId }) : noAccountRights(db)
  const permissions = rights.permissions
  return {
    id: account?.id ?? null,
    employeeId,
    name: employee?.name ?? '',
    role,
    permissions,
    facilityId: terminal.facilityId,
    visibility: visibilityFor(permissions, settings),
    onTablet: true,
    ...homeStaff ? groupAccessFor(db, rights.scopes, employee.groupId) : ALL_GROUPS,
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
    canEdit: can(viewer.permissions, 'children.edit'),
    isManager: can(viewer.permissions, 'children.manage'),
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
 * tablet_locked otherwise; the request counts as use), an account with children.ownAccount (Leitung, Träger,
 * Gruppenleitung) in its facility (403 no_facility without one), the planned children as `visibilityFor` says. Every
 * other account, Mitarbeiter with or without the edit flag, sees no child data at all: 403 children_tablet_only.
 */
export function resolveChildViewer(db: Db, user: SessionUser, token: string | undefined, now: Date = new Date()): ChildViewer {
  if (user.role === 'terminal') {
    if (user.facilityId === null) throw new ServiceError(403, 'no_facility')
    return tabletChildViewer(db, { id: user.id, facilityId: user.facilityId }, token, now, true)
  }
  if (!can(user.permissions, 'children.ownAccount')) throw new ServiceError(403, 'children_tablet_only')
  if (user.facilityId === null) throw new ServiceError(403, 'no_facility')
  const employee = user.employeeId === null ? undefined
    : db.select({ name: employees.name, facilityId: employees.facilityId, groupId: employees.groupId })
      .from(employees).where(eq(employees.id, user.employeeId)).get()
  // As at the tablet: whose child switches reach only the own group sees that group (and those it may read).
  const homeStaff = employee !== undefined && employee.facilityId === user.facilityId
  return {
    id: user.id, employeeId: user.employeeId, name: employee?.name ?? user.username, role: user.role,
    permissions: user.permissions, facilityId: user.facilityId, onTablet: false,
    // Without children.planned (a Gruppenleitung) the tablet switches apply here too: no more than at the tablet.
    visibility: visibilityFor(user.permissions, getTabletSettings(db, user.facilityId)),
    // The scopes come with the permissions of this request (one read of the rights).
    ...homeStaff ? groupAccessFor(db, user.scopes, employee.groupId) : ALL_GROUPS,
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
