import { idParams } from '../../schemas'
import { deleteWeekTemplate } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteWeekTemplate(useDb(), admin.facilityId, id)
  return { ok: true }
})
