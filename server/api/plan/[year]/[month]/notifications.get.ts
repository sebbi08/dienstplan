import { monthParams } from '../../../../schemas'
import { releaseNotificationStatus } from '../../../../services/notifications'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return releaseNotificationStatus(useDb(), year, month)
})
