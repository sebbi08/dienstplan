import { attendanceHistoryQuery } from '../../schemas'
import { attendanceHistory } from '../../services/childAttendance'

/** The change history of a child's day, newest first. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { childId, date } = await getValidatedQuery(event, attendanceHistoryQuery.parse)
  return attendanceHistory(useDb(), viewer, childId, date)
})
