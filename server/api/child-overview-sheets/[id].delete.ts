import { idParams } from '../../schemas'
import { deleteOverviewSheet } from '../../services/childOverviewSheets'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteOverviewSheet(useDb(), admin.facilityId, id)
  return { ok: true }
})
