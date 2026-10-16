import { groupBookHistoryQuery } from '../../schemas'
import { groupBookHistory } from '../../services/groupBook'

/** The change history of a theme or a day's text in a group's weekly overview, newest first. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { groupId, field, date } = await getValidatedQuery(event, groupBookHistoryQuery.parse)
  return groupBookHistory(useDb(), viewer, groupId, field, date)
})
