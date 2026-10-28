import { formTemplateUpdateSchema, idParams } from '../../schemas'
import { updateTemplate } from '../../services/formTemplates'

/** Renames, archives / reactivates, marks as self-assessment or saves the content of a template. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, formTemplateUpdateSchema.parse)
  updateTemplate(useDb(), admin, admin.facilityId, id, body)
  return { ok: true }
})
