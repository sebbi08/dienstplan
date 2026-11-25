import { formCategoryNameSchema, idParams } from '../../schemas'
import { renameFormCategory } from '../../services/formTemplateCategories'

/** Renames a category of the facility's form templates (another facility's is 404). */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, formCategoryNameSchema.parse)
  renameFormCategory(useDb(), admin.facilityId, id, body)
  return { ok: true }
})
