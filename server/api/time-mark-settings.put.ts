import { timeMarkSettingsSchema } from '../schemas'
import { getTimeMarkSettings, setTimeMarkSettings } from '../services/timeMarkSettings'

/** The Leitung or Träger sets the tolerance and the early-leave switch of their facility; answers them as they are afterwards. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  setTimeMarkSettings(useDb(), admin.facilityId, await readValidatedBody(event, timeMarkSettingsSchema.parse))
  return getTimeMarkSettings(useDb(), admin.facilityId)
})
