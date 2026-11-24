import { idParams } from '../../schemas'
import { deleteSignRequest } from '../../services/signRequests'

/** Deletes a request with its PDF; the signed copies stay in the personnel files. */
export default defineServiceHandler(async (event) => {
  const sender = await requirePermission(event, 'signRequests.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteSignRequest(useDb(), await withHomeGroup(event, sender), id)
  return { ok: true }
})
