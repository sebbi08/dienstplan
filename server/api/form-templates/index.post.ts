import { formTemplateSchema } from '../../schemas'
import { createTemplate } from '../../services/formTemplates'

/** A new, empty template of the active facility. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const body = await readValidatedBody(event, formTemplateSchema.parse)
  return { id: createTemplate(useDb(), admin, admin.facilityId, body) }
})
