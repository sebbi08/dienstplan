import { coverageRuleSchema, idParams } from '../../schemas'
import { updateCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateCoverageRule(useDb(), id, await readValidatedBody(event, coverageRuleSchema.parse))
})
