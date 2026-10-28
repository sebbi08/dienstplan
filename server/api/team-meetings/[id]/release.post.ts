import { idParams } from '../../../schemas'
import { releaseTeamMeeting, teamMember } from '../../../services/teamMeetings'

/** „Freigeben“: the draft is locked and readable for all (Leitung and Träger of the active facility). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'teamMeetings.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return releaseTeamMeeting(useDb(), teamMember(useDb(), admin), id)
})
