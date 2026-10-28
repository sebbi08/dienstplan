import { timeDayNoteSchema } from '../../schemas'
import { setTimeDayNote } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { employeeId, date, note } = await readValidatedBody(event, timeDayNoteSchema.parse)
  setTimeDayNote(useDb(), admin.facilityId, employeeId, date, note)
  return { ok: true }
})
