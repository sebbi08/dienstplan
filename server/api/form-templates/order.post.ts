import { formTemplateOrderSchema } from '../../schemas'
import { orderTemplates } from '../../services/formTemplates'

/** The new order of the active templates of one category or subcategory (▲/▼); the pickers list them in it. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { categoryId, ids } = await readValidatedBody(event, formTemplateOrderSchema.parse)
  orderTemplates(useDb(), admin.facilityId, categoryId, ids)
  return { ok: true }
})
