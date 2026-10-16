import { groupBookWeekSchema } from '../../schemas'
import { setWeekTheme } from '../../services/groupBook'

/** Sets the theme ("Wochenthema / geplant") of a group's week; only in a group the viewer writes in. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const body = await readValidatedBody(event, groupBookWeekSchema.parse)
  setWeekTheme(useDb(), viewer, body.groupId, body.weekStart, body.text)
  return { ok: true }
})
