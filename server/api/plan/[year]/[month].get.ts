import { todayIso } from '../../../../shared/domain/dates'
import { monthParams } from '../../../schemas'
import { getMonthPlan } from '../../../services/plan'

export default defineServiceHandler(async (event) => {
  // Everyone with the released plan, and the facility's tablet; the service shows the draft only with plan.edit.
  const user = await requirePermission(event, 'plan.view', { allowTerminal: true })
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return getMonthPlan(useDb(), user, user.facilityId, year, month, todayIso())
})
