import { attendanceDayQuery } from '../../schemas'
import { getAttendanceDay } from '../../services/childAttendance'

/** The day list of the child attendance; every child viewer may read it. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { date } = await getValidatedQuery(event, attendanceDayQuery.parse)
  return getAttendanceDay(useDb(), viewer, date)
})
