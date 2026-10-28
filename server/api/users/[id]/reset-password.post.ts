import { idParams, passwordResetSchema } from '../../../schemas'
import { resetPassword } from '../../../services/users'

export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'users.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { password } = await readValidatedBody(event, passwordResetSchema.parse)
  resetPassword(useDb(), actor, id, password)
  return { ok: true }
})
