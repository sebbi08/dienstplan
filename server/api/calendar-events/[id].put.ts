import { calendarEventSchema, idParams } from '../../schemas'
import { updateCalendarEvent } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateCalendarEvent(useDb(), admin.facilityId, id, await readValidatedBody(event, calendarEventSchema.parse))
  return { ok: true }
})
