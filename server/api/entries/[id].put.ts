import { entryTimesSchema, idParams } from '../../schemas'
import { updateEntryTimes } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const change = await readValidatedBody(event, entryTimesSchema.parse)
  updateEntryTimes(useDb(), admin, admin.facilityId, id, change)
  return { ok: true }
})
