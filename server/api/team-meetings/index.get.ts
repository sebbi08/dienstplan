import { teamMeetingQuery } from '../../schemas'
import { listTeamMeetings, teamMember } from '../../services/teamMeetings'

/**
 * The facility's team meetings of a year with the templates and groups to choose from: every member of the facility
 * (Leitung/Träger, staff accounts, the facility's tablet without unlocking: no child data).
 */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'teamMeetings.write', { allowTerminal: true, facility: 'active' })
  const { year, groupId } = await getValidatedQuery(event, teamMeetingQuery.parse)
  const group = groupId === undefined ? 'all' : groupId === 0 ? 'facility' : groupId
  return listTeamMeetings(useDb(), teamMember(useDb(), user), { year, group })
})
