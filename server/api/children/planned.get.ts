import { todayIso } from '../../../shared/domain/dates'
import { listPlanned } from '../../services/children'

/** The waitlist and the contract children who have not started yet. */
export default defineServiceHandler(async (event) => {
  const user = await requireChildReader(event)
  return listPlanned(useDb(), user.facilityId, todayIso())
})
