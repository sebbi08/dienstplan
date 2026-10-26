import { idParams } from '../../schemas'
import { deleteTalk } from '../../services/staffTalks'

/** Deletes a talk with all its forms. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTalk(useDb(), admin.facilityId, id)
  return { ok: true }
})
