import { openKnowledgeCount } from '../../services/knowledge'

/**
 * How many entries of „Wissen“ the account's linked employee still has to confirm (0 without a linked employee), for the
 * count at „Dokumente“ in the menu.
 */
export default defineServiceHandler(async (event) => {
  const reader = await requirePermission(event, 'knowledge.view', { facility: 'active' })
  return { count: openKnowledgeCount(useDb(), reader) }
})
