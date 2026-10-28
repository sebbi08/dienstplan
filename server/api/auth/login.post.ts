import { loginSchema } from '../../schemas'
import { login, sessionPayload } from '../../services/auth'
import { USER_SESSION_SECONDS } from '../../lib/session'

export default defineServiceHandler(async (event) => {
  const body = await readValidatedBody(event, loginSchema.parse)
  const result = login(useDb(), body.username, body.password)
  if (!result.ok) {
    const code = { locked: 'login_locked', left: 'account_left', invalid: 'login_invalid' }[result.reason]
    throw createError({ statusCode: 401, statusMessage: code, data: { code } })
  }
  // The tablet keeps the long default cookie lifetime; everyone else expires after USER_SESSION_DAYS.
  const config = result.user.role === 'terminal' ? {} : { maxAge: USER_SESSION_SECONDS }
  const user = sessionPayload(result.user)
  await replaceUserSession(event, { user, loggedInAt: new Date().toISOString() }, config)
  return user
})
