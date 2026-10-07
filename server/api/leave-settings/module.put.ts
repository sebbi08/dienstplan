import { leaveModuleSchema } from '../../schemas'
import { setLeaveModule } from '../../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  setLeaveModule(useDb(), await readValidatedBody(event, leaveModuleSchema.parse))
  return { ok: true }
})
