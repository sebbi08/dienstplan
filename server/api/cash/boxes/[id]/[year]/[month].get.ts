import { cashMonthParams } from '../../../../../schemas'
import { cashMonth } from '../../../../../services/cashEntries'

/** One month's sheet of a box of the active facility (also of an archived box). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id, year, month } = await getValidatedRouterParams(event, cashMonthParams.parse)
  return cashMonth(useDb(), admin.facilityId, id, year, month)
})
