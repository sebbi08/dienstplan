import { userCreateSchema } from '../../schemas'
import { createUser } from '../../services/users'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return createUser(useDb(), await readValidatedBody(event, userCreateSchema.parse))
})
