import { templateOrderSchema } from '../../schemas'
import { orderEntries } from '../../services/printTemplates'

/**
 * The new order of one list of „Vorlagen“ (▲/▼) for whoever manages the Bögen: the entries they may move, both kinds
 * together (the PDF templates only with printTemplates.edit as well; see orderEntries). The pickers list the Bögen in it.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { categoryId, entries } = await readValidatedBody(event, templateOrderSchema.parse)
  orderEntries(useDb(), await withHomeGroup(event, admin), categoryId, entries)
  return { ok: true }
})
