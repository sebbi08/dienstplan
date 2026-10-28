import { idParams } from '../../schemas'
import { deleteTemplate } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTemplate(useDb(), admin.facilityId, id)
  return { ok: true }
})
