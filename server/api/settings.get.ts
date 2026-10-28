import { getSettings } from '../services/settings'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  return getSettings(useDb(), admin.facilityId)
})
