import { idParams } from '../../schemas'
import { deleteCalendarEvent } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'calendar.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCalendarEvent(useDb(), admin.facilityId, id)
  return { ok: true }
})
