import { getAppSettings } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return getAppSettings(useDb(), admin.facilityId)
})
