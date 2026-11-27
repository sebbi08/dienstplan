import { calendarEventSchema } from '../../schemas'
import { assertCurrentEventClient, createCalendarEvent } from '../../services/calendar'

/** A page from before „Wer sieht den Termin?“ gets a clear message (reload) instead of a bare 400. */
const eventBody = (body: unknown) => calendarEventSchema.parse(assertCurrentEventClient(body))

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'calendar.edit')
  return createCalendarEvent(useDb(), admin.facilityId, await readValidatedBody(event, eventBody))
})
