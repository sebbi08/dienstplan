import { userCreateSchema } from '../../schemas'
import { createUser } from '../../services/users'

export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'users.manage')
  return createUser(useDb(), actor, await readValidatedBody(event, userCreateSchema.parse))
})
