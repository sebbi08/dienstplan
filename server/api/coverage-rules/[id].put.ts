import { coverageRuleSchema, idParams } from '../../schemas'
import { updateCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateCoverageRule(useDb(), admin.facilityId, id, await readValidatedBody(event, coverageRuleSchema.parse))
})
