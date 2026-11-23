import { idParams, knowledgeConfirmSchema } from '../../../schemas'
import { confirmKnowledge } from '../../../services/knowledge'

/**
 * „Gelesen und verstanden“: at the facility's tablet a person of its list with their PIN (the same attempts and lock as
 * stamping), with an own account its linked employee.
 */
export default defineServiceHandler(async (event) => {
  const reader = await requirePermission(event, 'knowledge.view', { allowTerminal: true, facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, knowledgeConfirmSchema.parse)
  return confirmKnowledge(useDb(), await withHomeGroup(event, reader), id, body)
})
