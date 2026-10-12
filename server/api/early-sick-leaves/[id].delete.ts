import { idParams } from '../../schemas'
import { deleteEarlySickLeave } from '../../services/earlySickLeaves'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEarlySickLeave(useDb(), admin.facilityId, id)
  return { ok: true }
})
