import { todayIso } from '../../../shared/domain/dates'
import { listOpenReviews } from '../../services/children'

/** The active children with sections still to be confirmed after a group change. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  return listOpenReviews(useDb(), viewer.facilityId, todayIso(), viewer.groups)
})
