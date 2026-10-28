import type { H3Event } from 'h3'
import { PAGE_FACILITY_HEADER, SETTINGS_FACILITY_HEADER } from '../../shared/domain/pageFacility'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import { getActiveUser } from '../services/auth'
import { facilityExists } from '../services/facilities'
import { resolveChildViewer } from '../services/tabletUnlock'
import { asChildPermission, type ChildActor, type ChildActorKey, type ChildViewer } from '../lib/childViewer'
import { assertPageFacility, requestFacility } from '../lib/pageFacility'
import { USER_SESSION_DAYS, sessionExpired } from '../lib/session'

export { USER_SESSION_DAYS }

/** A user who works in a facility (every manager and tablet that passed the guards). */
export type FacilityUser = SessionUser & { facilityId: number }

function httpError(statusCode: number, code: string) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}

function hasFacility(user: SessionUser): user is FacilityUser {
  return user.facilityId !== null
}

/** A Träger's page loaded for another facility than the active one gets 409 `facility_changed` (see pageFacility.ts). */
function checkPageFacility(event: H3Event, user: SessionUser): void {
  assertPageFacility(user, getHeader(event, PAGE_FACILITY_HEADER))
}

/**
 * The user as this request works with them: checked against the stale-page rule with the active facility, and for the
 * Träger on the settings pages with the facility they edit there instead (see pageFacility.ts). The session stays as it
 * is; the request remembers the real active facility, so a second guard in the same route checks against it again.
 */
function withRequestFacility<T extends FacilityUser>(event: H3Event, user: T): T {
  const active: number = event.context.activeFacilityId ?? user.facilityId
  const facilityId = requestFacility({ ...user, facilityId: active }, {
    page: getHeader(event, PAGE_FACILITY_HEADER), settings: getHeader(event, SETTINGS_FACILITY_HEADER),
  }, id => facilityExists(useDb(), id))
  if (facilityId !== active) event.context.activeFacilityId = active
  return facilityId === user.facilityId ? user : { ...user, facilityId }
}

/**
 * The facility the user works in (for the Träger on the settings pages: the one they edit there); 403 `no_facility`
 * without one, 409 `facility_changed` from a stale Träger page.
 */
export function requireFacility(event: H3Event, user: SessionUser): number {
  if (!hasFacility(user)) throw httpError(403, 'no_facility')
  return withRequestFacility(event, user).facilityId
}

/**
 * Loads the current user fresh from the database with their permissions, so role, flag and permission changes and
 * deactivation apply immediately. On its own only for the fixed routes: the own data (`my/*`, bound to the employee
 * link), the password, the notifications, the leave module state and the print page.
 */
export async function requireUser(
  event: H3Event, options: { allowPasswordChange?: boolean; allowTerminal?: boolean } = {},
): Promise<SessionUser> {
  const session = await requireUserSession(event)
  const user = getActiveUser(useDb(), session.user.id)
  // Normal accounts keep the 30-day limit; only the tablet stays logged in for the cookie's full lifetime.
  if (!user || sessionExpired(user.role, session.loggedInAt)) {
    await clearUserSession(event)
    throw httpError(401, 'session_expired')
  }
  if (user.mustChangePassword && !options.allowPasswordChange) throw httpError(403, 'password_change_required')
  // The shared tablet may only stamp and see the general plan.
  if (user.role === 'terminal' && !options.allowTerminal) throw httpError(403, 'forbidden')
  return user
}

export interface PermissionOptions {
  /**
   * The facility's tablet gets in as well, without a permission of its own (the tablet role is fixed, not in the
   * catalog): the general plan, the team meetings, the print templates.
   */
  allowTerminal?: boolean
  /**
   * The facility the route works in. `request` (default): the active one, for the Träger on the settings pages the one
   * they edit there (403 no_facility without one, 409 facility_changed from a stale page, 404 facility_not_found).
   * `active`: always the active one (the header's facility switcher, the print templates). `none`: no facility at all
   * (routes that name their facility or work across every facility; 403 no_facility never comes).
   */
  facility?: 'request' | 'active' | 'none'
}

/**
 * The signed-in user with the permission `key` (403 forbidden otherwise; the tablet gets in only with `allowTerminal`,
 * and then without a permission), working in the facility `options.facility` names.
 */
export async function requirePermission(
  event: H3Event, key: PermissionKey, options: PermissionOptions & { facility: 'none' },
): Promise<SessionUser>
export async function requirePermission(
  event: H3Event, key: PermissionKey, options?: PermissionOptions & { facility?: 'request' | 'active' },
): Promise<FacilityUser>
export async function requirePermission(
  event: H3Event, key: PermissionKey, options: PermissionOptions = {},
): Promise<SessionUser> {
  const user = await requireUser(event, { allowTerminal: options.allowTerminal })
  if (user.role !== 'terminal' && !can(user.permissions, key)) throw httpError(403, 'forbidden')
  const facility = options.facility ?? 'request'
  if (facility === 'none') return user
  if (!hasFacility(user)) throw httpError(403, 'no_facility')
  if (facility === 'active') {
    checkPageFacility(event, user)
    return user
  }
  return withRequestFacility(event, user)
}

/** The shared tablet, which stamps for the employees of its own facility. */
export async function requireTerminal(event: H3Event): Promise<FacilityUser> {
  const user = await requireUser(event, { allowTerminal: true })
  if (user.role !== 'terminal') throw httpError(403, 'forbidden')
  if (!hasFacility(user)) throw httpError(403, 'no_facility')
  return user
}

/** The tablet's unlock token, kept in the server-only part of the session (never sent to the browser). */
export async function childUnlockToken(event: H3Event): Promise<string | undefined> {
  return (await getUserSession(event)).secure?.childUnlock
}

/** Remembers the tablet's unlock token in the server-only part of the session. */
export async function storeChildUnlockToken(event: H3Event, token: string): Promise<void> {
  await setUserSession(event, { secure: { childUnlock: token } })
}

/**
 * Whoever looks at child records (see `resolveChildViewer`) with the permission `key`: an account with
 * children.ownAccount (Träger and Leitung), or the person who unlocked the facility's tablet, with that person's
 * permissions. Any other account gets 403 children_tablet_only, a locked tablet 403 tablet_locked, a viewer without the
 * key 403 forbidden; children.edit and children.manage also need an account (403 forbidden for a person without one).
 */
export async function requireChildPermission(event: H3Event, key: ChildActorKey): Promise<ChildActor>
export async function requireChildPermission(event: H3Event, key: PermissionKey): Promise<ChildViewer>
export async function requireChildPermission(event: H3Event, key: PermissionKey): Promise<ChildViewer> {
  const user = await requireUser(event, { allowTerminal: true })
  const token = await childUnlockToken(event)
  // The tablet has one facility; only an office account's page can be stale, and only the Träger's settings pages (care
  // and document types) name another facility.
  const reader = can(user.permissions, 'children.ownAccount') && hasFacility(user) ? withRequestFacility(event, user) : user
  return asChildPermission(resolveChildViewer(useDb(), reader, token), key)
}
