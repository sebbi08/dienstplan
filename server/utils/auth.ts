import type { H3Event } from 'h3'
import type { SessionUser } from '../../shared/types/api'
import { getActiveUser } from '../services/auth'

function httpError(statusCode: number, code: string) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}

/** Loads the current user fresh from the database, so role changes and deactivation apply immediately. */
export async function requireUser(event: H3Event, options: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const session = await requireUserSession(event)
  const user = getActiveUser(useDb(), session.user.id)
  if (!user) {
    await clearUserSession(event)
    throw httpError(401, 'session_expired')
  }
  if (user.mustChangePassword && !options.allowPasswordChange) throw httpError(403, 'password_change_required')
  return user
}

export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw httpError(403, 'forbidden')
  return user
}
