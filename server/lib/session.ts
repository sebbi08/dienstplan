import type { Role } from '../../shared/types/api'

/** Normal accounts must log in again after this many days; the shared tablet stays logged in as long as the cookie lives. */
export const USER_SESSION_DAYS = 30
export const USER_SESSION_SECONDS = USER_SESSION_DAYS * 24 * 60 * 60

/** True when a session of a non-tablet user is older than USER_SESSION_DAYS or carries no valid login time. */
export function sessionExpired(role: Role, loggedInAt: string | undefined, now: Date = new Date()): boolean {
  if (role === 'terminal') return false
  const loggedIn = loggedInAt ? Date.parse(loggedInAt) : Number.NaN
  if (Number.isNaN(loggedIn)) return true
  return now.getTime() - loggedIn > USER_SESSION_SECONDS * 1000
}
