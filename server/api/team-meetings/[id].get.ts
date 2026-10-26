import { idParams } from '../../schemas'
import { getTeamMeeting, teamMember } from '../../services/teamMeetings'

/** One meeting of the facility with its minutes, draft or released (every member of the facility). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event, { allowTerminal: true })
  requireFacility(event, user)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getTeamMeeting(useDb(), teamMember(useDb(), user), id)
})
