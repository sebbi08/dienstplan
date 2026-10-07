import { todayIso } from '../../../../shared/domain/dates'
import { monthParams } from '../../../schemas'
import { getMonthPlan } from '../../../services/plan'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event, { allowTerminal: true })
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return getMonthPlan(useDb(), user, requireFacility(event, user), year, month, todayIso())
})
