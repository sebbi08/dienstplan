import { listWeekTemplates } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit', { tabletPlanEdit: true })
  return listWeekTemplates(useDb(), admin.facilityId)
})
