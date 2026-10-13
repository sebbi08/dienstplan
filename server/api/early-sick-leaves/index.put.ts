import { earlySickLeaveSchema } from '../../schemas'
import { saveEarlySickLeave } from '../../services/earlySickLeaves'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  saveEarlySickLeave(useDb(), admin, admin.facilityId, await readValidatedBody(event, earlySickLeaveSchema.parse))
  return { ok: true }
})
