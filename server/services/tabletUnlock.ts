import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { effectiveRights, type BundleScope } from '../../shared/domain/permissionBundles'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { berlinDate, type NoLockPeriod } from '../../shared/domain/tablet'
import type {
  ChildRightsDto, GroupAccess, SessionUser, TabletPlanEditDto, TabletSettingsDto, TabletUnlockStatusDto, TerminalPersonDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, terminalUnlocks, users } from '../db/schema'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { readableGroupIds } from './groupReadAccess'
import { accountRights, roleBundleRows } from './permissions'
import { deleteExpiredUnlocks, noLockPeriodsOn, validUntil } from './tabletNoLock'
import { getTabletSettings, getTabletSwitches } from './tabletSettings'
import { terminalStatus, verifyEmployeePin } from './terminal'

export { deleteExpiredUnlocks } from './tabletNoLock'

type UnlockRow = typeof terminalUnlocks.$inferSelect
type Terminal = { id: number; facilityId: number }
type TabletSwitches = Omit<TabletSettingsDto, 'noLockWindows'>
type Resolved =
  | { unlocked: false; dropped?: UnlockRow }
  | {
    unlocked: true; row: UnlockRow; person: TerminalPersonDto; settings: TabletSettingsDto; viewer: ChildViewer
    periods: NoLockPeriod[]
  }

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
function visibilityFor(permissions: ReadonlySet<PermissionKey>, settings: TabletSwitches): ChildViewer['visibility'] {
  return can(permissions, 'children.planned') ? null
    : { waitlist: settings.showWaitlist, futureContracts: settings.showFutureContracts }
}

/** Every group, for a viewer without a home group of the facility (helpers, the Träger, staff without group). */
const ALL_GROUPS: GroupScopes = { groups: null, writeGroups: { attendance: null, edit: null } }

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

/**
 * Whether the person who unlocked may edit this facility's plan at the tablet: only with an active account of their
 * own in the home facility (`viewer.id`, as for changing child records: the plan's history names an account) whose
 * permissions there hold plan.edit. A person without one never does, whatever the Mitarbeiter role settings say.
 */
function mayEditPlan(viewer: ChildViewer): boolean {
  return viewer.id !== null && can(viewer.permissions, 'plan.edit')
}

/**
 * Looks at the unlock the token stands for; never writes. A person who dropped off the tablet list is reported as
 * dropped, and so is a person editing the plan whose account lost plan.edit meanwhile (the tablet locks: editing rights
 * are never kept). While the plan is edited, the facility's windows without the automatic lock do not apply: an
 * unattended tablet must not keep an account's plan rights open for hours.
 */
function resolveUnlock(db: Db, terminal: Terminal, token: string | undefined, now: Date): Resolved {
  const row = token ? db.select().from(terminalUnlocks).where(eq(terminalUnlocks.id, token)).get() : undefined
  if (!row || row.terminalUserId !== terminal.id || row.facilityId !== terminal.facilityId) return { unlocked: false }
  const settings = getTabletSettings(db, terminal.facilityId)
  // The windows of the day of the last use decide; today's go to the tablet as well (a touch moves the last use there).
  const periods = row.planEditSince ? [] : noLockPeriodsOn(db, terminal.facilityId, settings.noLockWindows,
    [berlinDate(Date.parse(row.lastActiveAt)), berlinDate(now.getTime())])
  if (now.getTime() > validUntil(row.lastActiveAt, settings.lockMinutes, periods)) return { unlocked: false }
  const person = terminalStatus(db, terminal.facilityId, now).find(candidate => candidate.employeeId === row.employeeId)
  if (!person) return { unlocked: false, dropped: row }
  const viewer = viewerFor(db, terminal, row.employeeId, settings)
  if (row.planEditSince && !mayEditPlan(viewer)) return { unlocked: false, dropped: row }
  return { unlocked: true, row, person, settings, viewer, periods }
}

/** „Dienstplan bearbeiten“ in the status: null when the person may not; else whether they do and what else they may. */
function planEditOf(row: UnlockRow, viewer: ChildViewer): TabletPlanEditDto | null {
  if (!mayEditPlan(viewer)) return null
  return {
    active: row.planEditSince !== null,
    canRelease: can(viewer.permissions, 'plan.release'),
    seesPersonal: can(viewer.permissions, 'employees.personal'),
  }
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

/** The status for the tablet, with the stretches of the day of the last use and of today (the tablet's timer needs no others). */
function statusOf(resolved: Resolved): TabletUnlockStatusDto {
  if (!resolved.unlocked) return { unlocked: false }
  return {
    unlocked: true, employeeId: resolved.person.employeeId, name: resolved.person.name,
    rights: rightsOf(resolved.viewer), lockMinutes: resolved.settings.lockMinutes,
    noLockPeriods: resolved.periods
      .map(period => ({ from: new Date(period.from).toISOString(), until: new Date(period.until).toISOString() })),
    planEdit: planEditOf(resolved.row, resolved.viewer),
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
 * valid unlock: no row for the token, a row of another tablet or facility, the lock time plus grace over (counted from the
 * last use, or from the end of a window without the automatic lock the unlock reached; see validUntil), or the person
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
    visibility: visibilityFor(user.permissions, getTabletSwitches(db, user.facilityId)),
    // The scopes come with the permissions of this request (one read of the rights).
    ...homeStaff ? groupAccessFor(db, user.scopes, employee.groupId) : ALL_GROUPS,
  }
}

/** Like tabletChildViewer, but answers { unlocked: false } instead of throwing and changes nothing. */
export function tabletUnlockStatus(db: Db, terminal: Terminal, token: string | undefined, now: Date = new Date()): TabletUnlockStatusDto {
  return statusOf(resolveUnlock(db, terminal, token, now))
}

/** The valid unlock (403 tablet_locked otherwise, deleting a dropped one, as tabletChildViewer does). */
function validUnlock(db: Db, terminal: Terminal, token: string | undefined, now: Date): Extract<Resolved, { unlocked: true }> {
  const resolved = resolveUnlock(db, terminal, token, now)
  if (!resolved.unlocked) {
    if (resolved.dropped) lockChildren(db, resolved.dropped.terminalUserId, resolved.dropped.id)
    throw new ServiceError(403, 'tablet_locked')
  }
  return resolved
}

/**
 * „Dienstplan bearbeiten“ at the tablet: the person who unlocked it starts editing this facility's plan (403
 * tablet_locked without a valid unlock, 403 forbidden without an own account with plan.edit, see mayEditPlan). It stays
 * part of this unlock: locking, another person's unlock and the lock time end it; the windows without the automatic lock
 * no longer apply. Counts as use.
 */
export function startPlanEdit(db: Db, terminal: Terminal, token: string | undefined, now: Date = new Date()): TabletUnlockStatusDto {
  const { row, viewer } = validUnlock(db, terminal, token, now)
  if (!mayEditPlan(viewer)) throw new ServiceError(403, 'forbidden')
  const stamp = now.toISOString()
  db.update(terminalUnlocks).set({ planEditSince: row.planEditSince ?? stamp, lastActiveAt: stamp }).where(eq(terminalUnlocks.id, row.id)).run()
  return statusOf(resolveUnlock(db, terminal, token, now))
}

/**
 * Who edits the plan at this tablet, as their own account works in the tablet's facility: the account of the person
 * who unlocked it, with its permissions there read afresh (role settings and exceptions), so every change is recorded
 * with their account, as in the office. 403 tablet_locked without a valid unlock (none, another tablet's or facility's,
 * run out, the person off the tablet list, or the account no longer allowed – then the tablet is locked), 403 forbidden
 * while the unlock opens the child records only. The request counts as use.
 */
export function tabletPlanEditor(db: Db, terminal: Terminal, token: string | undefined, now: Date = new Date()): SessionUser {
  const { row, viewer } = validUnlock(db, terminal, token, now)
  if (!row.planEditSince || viewer.id === null) throw new ServiceError(403, 'forbidden')
  // resolveUnlock checked the account (home staff, active, plan.edit) through the viewer; read once more for the
  // session's fields and the scopes.
  const account = db.select().from(users).where(and(eq(users.id, viewer.id), eq(users.active, true))).get()
  if (!account) throw new ServiceError(403, 'forbidden')
  const rights = accountRights(db, { id: account.id, role: account.role, facilityId: terminal.facilityId })
  if (!can(rights.permissions, 'plan.edit')) throw new ServiceError(403, 'forbidden')
  db.update(terminalUnlocks).set({ lastActiveAt: now.toISOString() }).where(eq(terminalUnlocks.id, row.id)).run()
  return {
    id: account.id, username: account.username, role: account.role, employeeId: account.employeeId,
    mustChangePassword: account.mustChangePassword, facilityId: terminal.facilityId,
    permissions: rights.permissions, scopes: rights.scopes,
  }
}

/** Whether the unlock the token stands for (this tablet's) has started editing the plan, valid or not; never writes. */
export function planEditStarted(db: Db, terminal: Terminal, token: string | undefined): boolean {
  if (!token) return false
  const row = db.select({ terminalUserId: terminalUnlocks.terminalUserId, planEditSince: terminalUnlocks.planEditSince })
    .from(terminalUnlocks).where(eq(terminalUnlocks.id, token)).get()
  return row?.terminalUserId === terminal.id && row.planEditSince !== null
}
