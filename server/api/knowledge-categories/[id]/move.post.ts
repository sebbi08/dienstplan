import { idParams, moveSchema } from '../../../schemas'
import { moveKnowledgeCategory } from '../../../services/knowledge'

/** One place up or down among the categories the editor sees. */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveKnowledgeCategory(useDb(), editor, id, direction)
  return { ok: true }
})
