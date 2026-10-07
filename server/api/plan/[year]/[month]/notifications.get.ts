import { monthParams } from '../../../../schemas'
import { releaseNotificationStatus } from '../../../../services/notifications'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return releaseNotificationStatus(useDb(), admin.facilityId, year, month)
})
