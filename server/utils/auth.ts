import type { H3Event } from 'h3'
import { isManager } from '../../shared/domain/roles'
import type { SessionUser } from '../../shared/types/api'
import { getActiveUser } from '../services/auth'
import { USER_SESSION_DAYS, sessionExpired } from '../lib/session'

export { USER_SESSION_DAYS }

function httpError(statusCode: number, code: string) {
  return createError({ statusCode, statusMessage: code, data: { code } })
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

export async function requireTerminal(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event, { allowTerminal: true })
  if (user.role !== 'terminal') throw httpError(403, 'forbidden')
  return user
}

/** Träger or Leitung (everything that runs the facility). */
export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (!isManager(user.role)) throw httpError(403, 'forbidden')
  return user
}

/** Only the Träger: contract data of employees and Träger accounts. */
export async function requireProvider(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (user.role !== 'provider') throw httpError(403, 'forbidden')
  return user
}
