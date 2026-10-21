import type { H3Event } from 'h3'
import { PAGE_FACILITY_HEADER } from '../../shared/domain/pageFacility'
import { isManager } from '../../shared/domain/roles'
import type { SessionUser } from '../../shared/types/api'
import { getActiveUser } from '../services/auth'
import { templateReaderFacility } from '../services/printTemplates'
import { resolveChildViewer } from '../services/tabletUnlock'
import { asChildEditor, asChildManager, type ChildActor, type ChildViewer } from '../lib/childViewer'
import { assertPageFacility } from '../lib/pageFacility'
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

/** The facility the user works in; 403 `no_facility` without one, 409 `facility_changed` from a stale Träger page. */
export function requireFacility(event: H3Event, user: SessionUser): number {
  if (!hasFacility(user)) throw httpError(403, 'no_facility')
  checkPageFacility(event, user)
  return user.facilityId
}

/** Loads the current user fresh from the database, so role changes and deactivation apply immediately. */
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

/** The shared tablet, which stamps for the employees of its own facility. */
export async function requireTerminal(event: H3Event): Promise<FacilityUser> {
  const user = await requireUser(event, { allowTerminal: true })
  if (user.role !== 'terminal') throw httpError(403, 'forbidden')
  if (!hasFacility(user)) throw httpError(403, 'no_facility')
  return user
}

/** Träger or Leitung (everything that runs the facility), working in their (active) facility. */
export async function requireAdmin(event: H3Event): Promise<FacilityUser> {
  const user = await requireUser(event)
  if (!isManager(user.role)) throw httpError(403, 'forbidden')
  if (!hasFacility(user)) throw httpError(403, 'no_facility')
  checkPageFacility(event, user)
  return user
}

/**
 * Whoever opens the print templates (blank forms, no child data): Träger and Leitung in their (active) facility, and the
 * facility's tablet without unlocking it. A Mitarbeiter account gets 403 forbidden.
 */
export async function requireTemplateReader(event: H3Event): Promise<FacilityUser> {
  const user = await requireUser(event, { allowTerminal: true })
  const facilityId = templateReaderFacility(user)
  checkPageFacility(event, user)
  return { ...user, facilityId }
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
 * Whoever looks at child records (see `resolveChildViewer`): Träger and Leitung with their own account, or the person
 * who unlocked the facility's tablet. A Mitarbeiter account gets 403 children_tablet_only, a locked tablet 403
 * tablet_locked.
 */
export async function requireChildReader(event: H3Event): Promise<ChildViewer> {
  const user = await requireUser(event, { allowTerminal: true })
  const viewer = resolveChildViewer(useDb(), user, await childUnlockToken(event))
  // The tablet has one facility; only a Träger's page can be stale.
  if (!viewer.onTablet) checkPageFacility(event, user)
  return viewer
}

/** Whoever may maintain child records: the managers, and Mitarbeiter with the permission at the tablet. */
export async function requireChildEditor(event: H3Event): Promise<ChildActor> {
  return asChildEditor(await requireChildReader(event))
}

/** Träger or Leitung on the child pages, at the office or at the unlocked tablet (archive, occupancy, group changes …). */
export async function requireChildManager(event: H3Event): Promise<ChildActor> {
  return asChildManager(await requireChildReader(event))
}

/** Only the Träger: contract data of employees, Träger accounts and the facilities. */
export async function requireProvider(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (user.role !== 'provider') throw httpError(403, 'forbidden')
  return user
}
