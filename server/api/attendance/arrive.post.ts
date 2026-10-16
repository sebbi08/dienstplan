import { attendanceArriveSchema } from '../../schemas'
import { arrive } from '../../services/childAttendance'

/** Stamps a child in; every child viewer may, also for older days. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const body = await readValidatedBody(event, attendanceArriveSchema.parse)
  return { id: arrive(useDb(), viewer, body) }
})
