import { timeRecordCreateSchema } from '../../schemas'
import { createRecord } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  createRecord(useDb(), admin, admin.facilityId, await readValidatedBody(event, timeRecordCreateSchema.parse))
  return { ok: true }
})
