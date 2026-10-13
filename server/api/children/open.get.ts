import { todayIso } from '../../../shared/domain/dates'
import { listOpenReviews } from '../../services/children'

/** The active children with sections still to be confirmed after a group change. */
export default defineServiceHandler(async (event) => {
  const user = await requireChildReader(event)
  return listOpenReviews(useDb(), user.facilityId, todayIso())
})
