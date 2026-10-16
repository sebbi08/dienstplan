import { groupBookDaySchema } from '../../schemas'
import { setDayNote } from '../../services/groupBook'

/** Sets what a group did on a day (Monday to Friday); only in a group the viewer writes in. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const body = await readValidatedBody(event, groupBookDaySchema.parse)
  setDayNote(useDb(), viewer, body.groupId, body.date, body.text)
  return { ok: true }
})
