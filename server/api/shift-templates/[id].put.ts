import { idParams, templateSchema } from '../../schemas'
import { updateTemplate } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateTemplate(useDb(), id, await readValidatedBody(event, templateSchema.parse))
})
