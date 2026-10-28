import { monthParams } from '../../../../schemas'
import { releaseMonth } from '../../../../services/release'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.release')
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return releaseMonth(useDb(), admin, admin.facilityId, year, month)
})
