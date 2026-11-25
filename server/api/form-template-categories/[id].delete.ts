import { idParams } from '../../schemas'
import { deleteFormCategory } from '../../services/formTemplateCategories'

/** Deletes an empty category without subcategories (409 otherwise). */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteFormCategory(useDb(), admin.facilityId, id)
  return { ok: true }
})
