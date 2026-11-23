import { knowledgeCategorySchema } from '../../schemas'
import { createKnowledgeCategory } from '../../services/knowledge'

export default defineServiceHandler(async (event) => {
  // The categories of the active facility (another facility's is 404).
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const body = await readValidatedBody(event, knowledgeCategorySchema.parse)
  return { id: createKnowledgeCategory(useDb(), editor, body) }
})
