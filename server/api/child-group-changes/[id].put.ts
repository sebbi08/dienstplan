import { todayIso } from '../../../shared/domain/dates'
import { groupChangeSchema, idParams } from '../../schemas'
import { updateGroupChange } from '../../services/childGroupChanges'

/** Changes a planned group change that is not applied yet. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, groupChangeSchema.parse)
  updateGroupChange(useDb(), admin, admin.facilityId, id, body, todayIso())
  return { ok: true }
})
