import { formTemplateOrderSchema } from '../../schemas'
import { orderTemplates } from '../../services/formTemplates'

/** The new order of the active templates of one kind (▲/▼); the pickers list them in it. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { kind, ids } = await readValidatedBody(event, formTemplateOrderSchema.parse)
  orderTemplates(useDb(), admin.facilityId, kind, ids)
  return { ok: true }
})
