import { idParams, timeRecordUpdateSchema } from '../../schemas'
import { updateRecord } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateRecord(useDb(), admin, id, await readValidatedBody(event, timeRecordUpdateSchema.parse))
  return { ok: true }
})
