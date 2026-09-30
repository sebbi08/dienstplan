import { idParams } from '../../schemas'
import { deleteEntry } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEntry(useDb(), admin, id)
  return { ok: true }
})
