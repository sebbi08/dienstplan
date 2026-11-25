import { knowledgeOrderSchema } from '../../schemas'
import { orderKnowledgeEntries } from '../../services/knowledge'

/**
 * ▲/▼: the new order of one list (a subcategory, the entries directly in a category, or „Vom Träger“): exactly the
 * entries of it the editor sees, the facility's own and the Träger's. For an entry of the Träger it is this facility's
 * order alone.
 */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const { categoryId, ids } = await readValidatedBody(event, knowledgeOrderSchema.parse)
  orderKnowledgeEntries(useDb(), await withHomeGroup(event, editor), categoryId, ids)
  return { ok: true }
})
