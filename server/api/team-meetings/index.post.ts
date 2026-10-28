import { teamMeetingCreateSchema } from '../../schemas'
import { createTeamMeeting, teamMember } from '../../services/teamMeetings'

/** A new draft meeting from an active team template of the facility (every member of the facility). */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'teamMeetings.write', { allowTerminal: true, facility: 'active' })
  const body = await readValidatedBody(event, teamMeetingCreateSchema.parse)
  return { id: createTeamMeeting(useDb(), teamMember(useDb(), user), body) }
})
