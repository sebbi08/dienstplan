import { idParams } from '../../schemas'
import { deleteEntry } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit', { tabletPlanEdit: true })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEntry(useDb(), admin, admin.facilityId, id)
  return { ok: true }
})
