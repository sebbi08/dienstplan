import { idParams } from '../../schemas'
import { deleteTraining } from '../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTraining(useDb(), admin.facilityId, id)
  return { ok: true }
})
