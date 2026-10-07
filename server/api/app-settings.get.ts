import { getAppSettings } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return getAppSettings(useDb(), admin.facilityId)
})
