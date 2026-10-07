import { idParams } from '../../schemas'
import { deleteCalendarEvent } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCalendarEvent(useDb(), admin.facilityId, id)
  return { ok: true }
})
