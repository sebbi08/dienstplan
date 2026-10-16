import { todayIso } from '../../../shared/domain/dates'
import { childListQuery } from '../../schemas'
import { listChildren } from '../../services/children'

/** The facility's active or planned children. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { status } = await getValidatedQuery(event, childListQuery.parse)
  return listChildren(useDb(), viewer.facilityId, status, todayIso(), viewer.groups)
})
