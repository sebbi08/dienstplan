import { calendarEventSchema, idParams } from '../../schemas'
import { assertCurrentEventClient, updateCalendarEvent } from '../../services/calendar'

/** A page from before „Wer sieht den Termin?“ gets a clear message (reload) instead of a bare 400. */
const eventBody = (body: unknown) => calendarEventSchema.parse(assertCurrentEventClient(body))

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'calendar.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateCalendarEvent(useDb(), admin.facilityId, id, await readValidatedBody(event, eventBody))
  return { ok: true }
})
