import { staffTalkQuery } from '../../schemas'
import { listTalks } from '../../services/staffTalks'

/** The active facility's talks with one employee, newest first, with all their forms. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { employeeId } = await getValidatedQuery(event, staffTalkQuery.parse)
  return listTalks(useDb(), scope, employeeId)
})
