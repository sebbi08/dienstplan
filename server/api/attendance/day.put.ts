import { attendanceDaySchema } from '../../schemas'
import { updateDay } from '../../services/childAttendance'

/** Changes planned pickup, brought-by, the day's note or the meal ticks of a child's day. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const body = await readValidatedBody(event, attendanceDaySchema.parse)
  updateDay(useDb(), viewer, body)
  return { ok: true }
})
