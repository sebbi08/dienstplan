import { monthParams } from '../../schemas'
import { helpCandidates } from '../../services/helpOuts'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { year, month } = await getValidatedQuery(event, monthParams.parse)
  return helpCandidates(useDb(), admin.facilityId, year, month)
})
