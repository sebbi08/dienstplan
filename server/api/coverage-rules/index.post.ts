import { coverageRuleSchema } from '../../schemas'
import { createCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return createCoverageRule(useDb(), admin.facilityId, await readValidatedBody(event, coverageRuleSchema.parse))
})
