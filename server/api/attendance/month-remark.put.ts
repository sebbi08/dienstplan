import { attendanceMonthRemarkSchema } from '../../schemas'
import { setMonthRemark } from '../../services/childAttendance'

/** Sets the remark of a child for a month of the month table. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  setMonthRemark(useDb(), viewer, await readValidatedBody(event, attendanceMonthRemarkSchema.parse))
  return { ok: true }
})
