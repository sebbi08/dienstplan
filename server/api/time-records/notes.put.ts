import { timeDayNoteSchema } from '../../schemas'
import { setTimeDayNote } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { employeeId, date, note } = await readValidatedBody(event, timeDayNoteSchema.parse)
  setTimeDayNote(useDb(), employeeId, date, note)
  return { ok: true }
})
