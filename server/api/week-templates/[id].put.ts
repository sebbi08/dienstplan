import { idParams, weekTemplateRenameSchema } from '../../schemas'
import { renameWeekTemplate } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { name } = await readValidatedBody(event, weekTemplateRenameSchema.parse)
  renameWeekTemplate(useDb(), admin.facilityId, id, name)
  return { ok: true }
})
