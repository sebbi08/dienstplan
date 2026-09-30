import { idParams } from '../../schemas'
import { deleteClosure } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteClosure(useDb(), admin, id)
  return { ok: true }
})
