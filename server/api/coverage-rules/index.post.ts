import { coverageRuleSchema } from '../../schemas'
import { createCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return createCoverageRule(useDb(), await readValidatedBody(event, coverageRuleSchema.parse))
})
