import { todayIso } from '../../../shared/domain/dates'
import { upcomingSchoolChildren } from '../../services/occupancy'

/** The list "Schulkinder zum 1.9." of the facility the manager works in. */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  return upcomingSchoolChildren(useDb(), manager.facilityId, todayIso())
})
