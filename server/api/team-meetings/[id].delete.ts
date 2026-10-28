import { idParams } from '../../schemas'
import { deleteTeamMeeting, teamMember } from '../../services/teamMeetings'

/** Deletes a meeting with its minutes (Leitung and Träger of the active facility). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'teamMeetings.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTeamMeeting(useDb(), teamMember(useDb(), admin), id)
  return { ok: true }
})
