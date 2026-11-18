import { idParams } from '../../schemas'
import { getWeekTemplate } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getWeekTemplate(useDb(), admin.facilityId, id)
})
