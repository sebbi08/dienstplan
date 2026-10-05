import { idParams, templateChangeSchema } from '../../schemas'
import { saveTemplateChange } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { applyFrom, ...input } = await readValidatedBody(event, templateChangeSchema.parse)
  return saveTemplateChange(useDb(), admin, id, input, applyFrom ?? null)
})
