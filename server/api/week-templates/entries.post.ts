import { weekTemplateInputSchema } from '../../schemas'
import { createWeekTemplate } from '../../services/weekTemplates'

/** Creates a template from the editor's entries (saving a plan week is POST /api/week-templates). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  return createWeekTemplate(useDb(), admin.facilityId, await readValidatedBody(event, weekTemplateInputSchema.parse))
})
