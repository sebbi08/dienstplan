import { globalKnowledgeCategoryNames } from '../../services/knowledge'

/** The category names the facilities use, to offer the Träger for an entry for all facilities. */
export default defineServiceHandler(async (event) => {
  const provider = await requirePermission(event, 'knowledge.global', { facility: 'none' })
  return globalKnowledgeCategoryNames(useDb(), provider)
})
