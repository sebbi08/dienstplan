import { getSettings } from '../services/settings'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return getSettings(useDb(), admin.facilityId)
})
