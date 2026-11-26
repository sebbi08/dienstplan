import { todayIso } from '../../../../shared/domain/dates'
import { monthParams } from '../../../schemas'
import { getMonthPlan } from '../../../services/plan'

export default defineServiceHandler(async (event) => {
  // Everyone with the released plan, and the facility's tablet; the service shows the draft only with plan.edit. At the
  // tablet while a person edits the plan there („Dienstplan bearbeiten“): as that person's account (planReader).
  const user = await planReader(event, await requirePermission(event, 'plan.view', { allowTerminal: true }))
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return getMonthPlan(useDb(), user, user.facilityId, year, month, todayIso())
})
