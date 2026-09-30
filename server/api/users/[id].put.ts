import { idParams, userUpdateSchema } from '../../schemas'
import { updateUser } from '../../services/users'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateUser(useDb(), id, await readValidatedBody(event, userUpdateSchema.parse))
})
