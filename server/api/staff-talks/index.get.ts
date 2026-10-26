import { staffTalkQuery } from '../../schemas'
import { listTalks } from '../../services/staffTalks'

/** The active facility's talks with one employee, newest first, with all their forms. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { employeeId } = await getValidatedQuery(event, staffTalkQuery.parse)
  return listTalks(useDb(), admin.facilityId, employeeId)
})
