import { groupBookWeekQuery } from '../../schemas'
import { getGroupWeek } from '../../services/groupBook'

/** One week of a group's weekly overview (without groupId the own group); every child viewer may read the groups they see (others: 404). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { groupId, date } = await getValidatedQuery(event, groupBookWeekQuery.parse)
  return getGroupWeek(useDb(), viewer, groupId ?? null, date)
})
