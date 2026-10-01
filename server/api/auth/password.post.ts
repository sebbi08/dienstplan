import { passwordChangeSchema } from '../../schemas'
import { changePassword } from '../../services/auth'
import { USER_SESSION_SECONDS } from '../../lib/session'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event, { allowPasswordChange: true })
  const body = await readValidatedBody(event, passwordChangeSchema.parse)
  changePassword(useDb(), user.id, body.currentPassword, body.newPassword)
  const updated = { ...user, mustChangePassword: false }
  // setUserSession merges (defu) with the stored data, so loggedInAt is kept; the tablet never gets here
  // (requireUser rejects it), so the cookie keeps the normal 30-day lifetime.
  await setUserSession(event, { user: updated }, { maxAge: USER_SESSION_SECONDS })
  return updated
})
