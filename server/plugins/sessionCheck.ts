import { getActiveUser, sessionPayload } from '../services/auth'
import { sessionExpired } from '../lib/session'

// Runs on every GET /api/_auth/session (what useUserSession() calls, also during SSR).
// nuxt-auth-utils only unseals the cookie there, so an expired or deactivated user would
// still be reported as logged in: requireUser clears the cookie, but during SSR that
// Set-Cookie never reaches the browser. Throwing here makes the client composable reset
// its session to null, so the route middleware redirects to /login, and the next login
// replaces the stale cookie.
export default defineNitroPlugin(() => {
  sessionHooks.hook('fetch', (session) => {
    if (!session.user) return
    const user = getActiveUser(useDb(), session.user.id)
    if (!user || sessionExpired(user.role, session.loggedInAt, new Date())) {
      throw createError({ statusCode: 401, statusMessage: 'session_expired', data: { code: 'session_expired' } })
    }
    // Report the current role (e.g. after becoming Träger) and facility (e.g. after the Träger switched it) instead
    // of the ones stored in the cookie at login; the server checks rights against the database anyway, this only
    // keeps the menus and pages in step.
    Object.assign(session.user, sessionPayload(user))
    // The permissions, resolved for this request, for what the pages show (useCan). Only in this answer: the hook
    // changes the unsealed copy, the cookie is never written here.
    session.permissions = [...user.permissions]
  })
})
