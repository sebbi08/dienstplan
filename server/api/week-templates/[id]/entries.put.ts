import { idParams, weekTemplateInputSchema } from '../../../schemas'
import { replaceWeekTemplate } from '../../../services/weekTemplates'

/** Replaces name, scope and entries of a template with the editor's. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return replaceWeekTemplate(useDb(), admin.facilityId, id, await readValidatedBody(event, weekTemplateInputSchema.parse))
})
