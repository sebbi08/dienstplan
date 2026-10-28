import { idParams, printTemplateSchema } from '../../schemas'
import { updateTemplate } from '../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, printTemplateSchema.parse)
  updateTemplate(useDb(), admin, id, body)
  return { ok: true }
})
