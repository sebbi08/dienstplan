import { idParams } from '../../schemas'
import { deleteTemplate } from '../../services/formTemplates'

/** Deletes a template no form was made from (409 form_template_in_use otherwise: archive it instead). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTemplate(useDb(), admin.facilityId, id)
  return { ok: true }
})
