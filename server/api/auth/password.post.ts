import { passwordChangeSchema } from '../../schemas'
import { changePassword } from '../../services/auth'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event, { allowPasswordChange: true })
  const body = await readValidatedBody(event, passwordChangeSchema.parse)
  changePassword(useDb(), user.id, body.currentPassword, body.newPassword)
  const updated = { ...user, mustChangePassword: false }
  await setUserSession(event, { user: updated })
  return updated
})
