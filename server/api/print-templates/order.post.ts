import { templateOrderSchema } from '../../schemas'
import { orderEntries } from '../../services/printTemplates'

/**
 * The new order of one list of „Vorlagen“ (▲/▼): exactly the entries of it the editor may move, both kinds together (the
 * Bögen only with formTemplates.manage as well; see orderEntries). For the Träger's templates for all facilities it is
 * this facility's order alone.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'printTemplates.edit')
  const { categoryId, entries } = await readValidatedBody(event, templateOrderSchema.parse)
  orderEntries(useDb(), await withHomeGroup(event, admin), categoryId, entries)
  return { ok: true }
})
