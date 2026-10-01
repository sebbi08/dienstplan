import { appSettingsSchema } from '../schemas'
import { getAppSettings, setTimeTrackingFrom } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { timeTrackingFrom } = await readValidatedBody(event, appSettingsSchema.parse)
  setTimeTrackingFrom(useDb(), timeTrackingFrom)
  return getAppSettings(useDb())
})
