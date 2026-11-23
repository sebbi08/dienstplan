import { listKnowledge } from '../../services/knowledge'

export default defineServiceHandler(async (event) => {
  // „Wissen“: every account (knowledge.view, a baseline key) and the facility's tablet without an unlock (no personal
  // data), always in the active facility; each sees the categories of their level.
  const reader = await requirePermission(event, 'knowledge.view', { allowTerminal: true, facility: 'active' })
  return listKnowledge(useDb(), await withHomeGroup(event, reader))
})
