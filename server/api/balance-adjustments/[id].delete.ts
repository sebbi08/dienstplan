import { idParams } from '../../schemas'
import { deleteAdjustment } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteAdjustment(useDb(), id)
  return { ok: true }
})
