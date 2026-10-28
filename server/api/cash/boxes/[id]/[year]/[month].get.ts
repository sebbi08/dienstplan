import { todayIso } from '../../../../../../shared/domain/dates'
import { cashMonthParams } from '../../../../../schemas'
import { cashMonth } from '../../../../../services/cashEntries'

/** One month's sheet of a box of the active facility (also of an archived box), up to the running month. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'cash.view')
  const { id, year, month } = await getValidatedRouterParams(event, cashMonthParams.parse)
  return cashMonth(useDb(), admin.facilityId, id, year, month, todayIso())
})
