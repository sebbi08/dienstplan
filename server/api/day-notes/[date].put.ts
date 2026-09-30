import { dateParams, dayNoteSchema } from '../../schemas'
import { setDayNote } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { date } = await getValidatedRouterParams(event, dateParams.parse)
  const body = await readValidatedBody(event, dayNoteSchema.parse)
  setDayNote(useDb(), admin, date, body.field, body.value)
  return { ok: true }
})
