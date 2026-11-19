import type { YearCalendarDto } from '../../shared/types/api'
import { seesProtectedCodes } from '../lib/protectedCodes'
import { yearQuery } from '../schemas'
import { getYearCalendar } from '../services/calendar'
import { calendarLeaveRequests } from '../services/leaveRequests'

export default defineServiceHandler(async (event): Promise<YearCalendarDto> => {
  const admin = await requirePermission(event, 'calendar.edit')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  const db = useDb()
  // Open leave requests only for the Leitung, the Träger and the leave planners (null for anyone else with the calendar).
  // Mutterschutz and Beschäftigungsverbot only for whoever may see the case (else „abwesend“).
  const calendar = getYearCalendar(db, admin.facilityId, year, { showsProtected: seesProtectedCodes(admin) })
  return { ...calendar, requests: calendarLeaveRequests(db, admin, admin.facilityId, year) }
})
