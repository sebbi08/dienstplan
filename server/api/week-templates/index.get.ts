import { listWeekTemplates } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  return listWeekTemplates(useDb(), admin.facilityId)
})
