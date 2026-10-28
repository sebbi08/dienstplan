import { appSettingsSchema } from '../schemas'
import { getAppSettings, setTimeTrackingFrom } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { timeTrackingFrom } = await readValidatedBody(event, appSettingsSchema.parse)
  setTimeTrackingFrom(useDb(), admin.facilityId, timeTrackingFrom)
  return getAppSettings(useDb(), admin.facilityId)
})
