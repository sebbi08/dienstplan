import { printTemplateOrderSchema } from '../../schemas'
import { orderTemplates } from '../../services/printTemplates'

/**
 * The new order of one sub-tab (▲/▼): exactly the templates of it the editor sees. For the Träger's templates for all
 * facilities it is this facility's order alone.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'printTemplates.edit')
  const { categoryId, ids } = await readValidatedBody(event, printTemplateOrderSchema.parse)
  orderTemplates(useDb(), await withHomeGroup(event, admin), categoryId, ids)
  return { ok: true }
})
