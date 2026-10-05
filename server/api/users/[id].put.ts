import { idParams, userUpdateSchema } from '../../schemas'
import { updateUser } from '../../services/users'

export default defineServiceHandler(async (event) => {
  const actor = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateUser(useDb(), actor, id, await readValidatedBody(event, userUpdateSchema.parse))
})
