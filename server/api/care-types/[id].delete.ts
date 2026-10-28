import { idParams } from '../../schemas'
import { deleteCareType } from '../../services/careTypes'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCareType(useDb(), admin.facilityId, id)
  return { ok: true }
})
