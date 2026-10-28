import { idParams, timeRecordUpdateSchema } from '../../schemas'
import { updateRecord } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateRecord(useDb(), admin, admin.facilityId, id, await readValidatedBody(event, timeRecordUpdateSchema.parse))
  return { ok: true }
})
