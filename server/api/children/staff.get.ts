import { todayIso } from '../../../shared/domain/dates'
import { listChildStaff } from '../../services/children'

/** The facility's staff who can be chosen as a child's Bezugserzieher (id and name only). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  return listChildStaff(useDb(), viewer.facilityId, todayIso())
})
