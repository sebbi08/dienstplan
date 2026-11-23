import { idParams, moveSchema } from '../../../schemas'
import { moveKnowledgeEntry } from '../../../services/knowledge'

/** ▲/▼: one place up or down among the facility's own entries of the category. */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveKnowledgeEntry(useDb(), editor, id, direction)
  return { ok: true }
})
