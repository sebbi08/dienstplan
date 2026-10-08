import { entryGroupSchema, idParams } from '../../../schemas'
import { setEntryGroup } from '../../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { groupId } = await readValidatedBody(event, entryGroupSchema.parse)
  setEntryGroup(useDb(), admin, admin.facilityId, id, groupId)
  return { ok: true }
})
