import { idParams } from '../../../schemas'
import { deleteMeeting } from '../../../services/parentMeetings'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteMeeting(useDb(), actor, id)
  return { ok: true }
})
