import { idParams } from '../../schemas'
import { deleteCalendarEvent } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCalendarEvent(useDb(), id)
  return { ok: true }
})
