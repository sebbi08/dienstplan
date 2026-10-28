import { idParams } from '../../schemas'
import { removeHelpOut } from '../../services/helpOuts'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  removeHelpOut(useDb(), admin.facilityId, id)
  return { ok: true }
})
