import { todayIso } from '../../../../../shared/domain/dates'
import { monthParams } from '../../../../schemas'
import { getMyPlan } from '../../../../services/plan'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return getMyPlan(useDb(), user, year, month, todayIso())
})
