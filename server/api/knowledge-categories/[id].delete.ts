import { idParams } from '../../schemas'
import { deleteKnowledgeCategory } from '../../services/knowledge'

/** Only an empty category (409 knowledge_category_not_empty while the facility has entries in it). */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteKnowledgeCategory(useDb(), editor, id)
  return { ok: true }
})
