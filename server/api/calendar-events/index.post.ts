import { calendarEventSchema } from '../../schemas'
import { createCalendarEvent } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return createCalendarEvent(useDb(), await readValidatedBody(event, calendarEventSchema.parse))
})
