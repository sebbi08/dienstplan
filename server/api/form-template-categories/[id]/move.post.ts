import { idParams, moveSchema } from '../../../schemas'
import { moveFormCategory } from '../../../services/formTemplateCategories'

/** One place up or down among its siblings (the categories, or the subcategories of its category). */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveFormCategory(useDb(), admin.facilityId, id, direction)
  return { ok: true }
})
