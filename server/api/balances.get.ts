import { todayIso } from '../../shared/domain/dates'
import { monthParams } from '../schemas'
import { getBalanceOverview } from '../services/balances'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year, month } = await getValidatedQuery(event, monthParams.parse)
  return getBalanceOverview(useDb(), year, month, todayIso())
})
