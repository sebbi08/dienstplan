import { idParams } from '../../schemas'
import { deleteGroupChange } from '../../services/childGroupChanges'

/** Deletes a planned group change that is not applied yet. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteGroupChange(useDb(), admin.facilityId, id)
  return { ok: true }
})
