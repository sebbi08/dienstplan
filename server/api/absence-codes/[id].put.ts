import { codeUpdateSchema, idParams } from '../../schemas'
import { updateCode } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateCode(useDb(), id, await readValidatedBody(event, codeUpdateSchema.parse))
})
