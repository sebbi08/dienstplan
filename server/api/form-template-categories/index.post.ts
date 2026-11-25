import { formCategorySchema } from '../../schemas'
import { createFormCategory } from '../../services/formTemplateCategories'

/** A new category (with `parentId` a subcategory) of the facility's form templates. */
export default defineServiceHandler(async (event): Promise<{ id: number }> => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const body = await readValidatedBody(event, formCategorySchema.parse)
  return { id: createFormCategory(useDb(), admin.facilityId, body) }
})
