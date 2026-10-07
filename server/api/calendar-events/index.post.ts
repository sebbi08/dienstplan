import { calendarEventSchema } from '../../schemas'
import { createCalendarEvent } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return createCalendarEvent(useDb(), admin.facilityId, await readValidatedBody(event, calendarEventSchema.parse))
})
