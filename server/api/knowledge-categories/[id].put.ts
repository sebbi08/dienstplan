import { idParams, knowledgeCategoryUpdateSchema } from '../../schemas'
import { updateKnowledgeCategory } from '../../services/knowledge'

export default defineServiceHandler(async (event) => {
  // The categories of the active facility (another facility's is 404).
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, knowledgeCategoryUpdateSchema.parse)
  updateKnowledgeCategory(useDb(), editor, id, body)
  return { ok: true }
})
