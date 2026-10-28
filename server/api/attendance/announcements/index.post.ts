import { attendanceAnnouncementSchema } from '../../../schemas'
import { announcePickup } from '../../../services/childAttendance'

/** Announces a person who picks the child up on that day. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const body = await readValidatedBody(event, attendanceAnnouncementSchema.parse)
  return { id: announcePickup(useDb(), viewer, body) }
})
