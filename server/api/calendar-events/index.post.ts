import { calendarEventSchema } from '../../schemas'
import { createCalendarEvent } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'calendar.edit')
  return createCalendarEvent(useDb(), admin.facilityId, await readValidatedBody(event, calendarEventSchema.parse))
})
