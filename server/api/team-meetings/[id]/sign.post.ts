import { idParams, teamMeetingSignSchema } from '../../../schemas'
import { signTeamMeeting, teamMember } from '../../../services/teamMeetings'

/**
 * „Gelesen und unterzeichnen“ of the released minutes: a participant with their own account, or at the facility's tablet
 * with the chosen person and their PIN. With an account the body may be empty or left out.
 */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'teamMeetings.write', { allowTerminal: true, facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const input = await readValidatedBody(event, body => teamMeetingSignSchema.parse(body ?? {}))
  return signTeamMeeting(useDb(), teamMember(useDb(), user), id, input)
})
