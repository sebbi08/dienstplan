import { attendanceLeaveSchema } from '../../schemas'
import { leave } from '../../services/childAttendance'

/** Stamps a child out with the person picking it up (checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const body = await readValidatedBody(event, attendanceLeaveSchema.parse)
  leave(useDb(), viewer, body)
  return { ok: true }
})
