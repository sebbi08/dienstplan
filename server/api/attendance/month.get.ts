import { attendanceMonthQuery } from '../../schemas'
import { getAttendanceMonth } from '../../services/childAttendance'

/** The month table of the child attendance; every child viewer may read it. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { year, month } = await getValidatedQuery(event, attendanceMonthQuery.parse)
  return getAttendanceMonth(useDb(), viewer, year, month)
})
