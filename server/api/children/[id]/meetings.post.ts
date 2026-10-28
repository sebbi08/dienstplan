import { idParams, parentMeetingSchema } from '../../../schemas'
import { addMeeting } from '../../../services/parentMeetings'

/** Enters a parent meeting in the child's record; the service checks the group right and keeps the note to managers. */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, parentMeetingSchema.parse)
  return { id: addMeeting(useDb(), actor, id, body) }
})
