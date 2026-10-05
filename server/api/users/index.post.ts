import { userCreateSchema } from '../../schemas'
import { createUser } from '../../services/users'

export default defineServiceHandler(async (event) => {
  const actor = await requireAdmin(event)
  return createUser(useDb(), actor, await readValidatedBody(event, userCreateSchema.parse))
})
