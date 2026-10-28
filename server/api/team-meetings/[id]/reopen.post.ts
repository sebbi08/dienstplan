import { idParams, teamMeetingReopenSchema } from '../../../schemas'
import { reopenTeamMeeting, teamMember } from '../../../services/teamMeetings'

/** „Wieder öffnen“ with a reason (1–200 characters): the released meeting is a draft again (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'teamMeetings.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { reason } = await readValidatedBody(event, teamMeetingReopenSchema.parse)
  return reopenTeamMeeting(useDb(), teamMember(useDb(), admin), id, reason)
})
