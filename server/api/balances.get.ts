import { todayIso } from '../../shared/domain/dates'
import { monthParams } from '../schemas'
import { getBalanceOverview } from '../services/balances'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { year, month } = await getValidatedQuery(event, monthParams.parse)
  return getBalanceOverview(useDb(), admin.facilityId, year, month, todayIso())
})
