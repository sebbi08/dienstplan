import { idParams, teamMeetingSaveSchema } from '../../schemas'
import { saveTeamMeeting, teamMember } from '../../services/teamMeetings'

/**
 * Saves header and minutes of a draft (every member of the facility; 409 team_meeting_released once released, 409
 * form_changed when someone saved in between); answers with the new last change.
 */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event, { allowTerminal: true })
  requireFacility(event, user)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, teamMeetingSaveSchema.parse)
  return saveTeamMeeting(useDb(), teamMember(useDb(), user), id, body)
})
