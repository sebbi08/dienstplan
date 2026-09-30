import { idParams } from '../../schemas'
import { deleteHours } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteHours(useDb(), id)
  return { ok: true }
})
