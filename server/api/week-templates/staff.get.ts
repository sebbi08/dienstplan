import { todayIso } from '../../../shared/domain/dates'
import { weekTemplateStaff } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  return weekTemplateStaff(useDb(), admin.facilityId, todayIso())
})
