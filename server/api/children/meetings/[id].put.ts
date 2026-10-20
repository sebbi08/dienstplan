import { idParams, parentMeetingSchema } from '../../../schemas'
import { updateMeeting } from '../../../services/parentMeetings'

/** Changes a parent meeting; without a note the stored one stays (staff never send one). */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, parentMeetingSchema.parse)
  updateMeeting(useDb(), actor, id, body)
  return { ok: true }
})
