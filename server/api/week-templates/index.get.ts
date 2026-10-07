import { listWeekTemplates } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return listWeekTemplates(useDb(), admin.facilityId)
})
