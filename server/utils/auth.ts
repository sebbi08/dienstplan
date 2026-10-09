import type { H3Event } from 'h3'
import { PAGE_FACILITY_HEADER } from '../../shared/domain/pageFacility'
import { isManager, mayEditChildren } from '../../shared/domain/roles'
import type { SessionUser } from '../../shared/types/api'
import { getActiveUser } from '../services/auth'
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

/** Whoever may see child records: Träger, Leitung and Mitarbeiter of a facility (never the tablet). */
export async function requireChildReader(event: H3Event): Promise<FacilityUser> {
  const user = await requireUser(event)
  requireFacility(event, user)
  return user as FacilityUser
}

/** Whoever may maintain child records: the managers, and Mitarbeiter with the permission. */
export async function requireChildEditor(event: H3Event): Promise<FacilityUser> {
  const user = await requireChildReader(event)
  if (!mayEditChildren(user)) throw httpError(403, 'forbidden')
  return user
}

/** Only the Träger: contract data of employees, Träger accounts and the facilities. */
export async function requireProvider(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (user.role !== 'provider') throw httpError(403, 'forbidden')
  return user
}
