import type { YearCalendarDto } from '../../shared/types/api'
import { seesProtectedCodes } from '../lib/protectedCodes'
import { printViewQuery, yearQuery } from '../schemas'
import { eventAudienceFor, getYearCalendar } from '../services/calendar'
import { calendarLeaveRequests } from '../services/leaveRequests'

export default defineServiceHandler(async (event): Promise<YearCalendarDto> => {
  const admin = await requirePermission(event, 'calendar.edit')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  const view = await getValidatedQuery(event, printViewQuery.parse)
  const db = useDb()
  // Open leave requests only for the Leitung, the Träger and the leave planners (null for anyone else with the calendar).
  // Mutterschutz and Beschäftigungsverbot only for whoever may see the case (else „abwesend“).
  // A full Elternzeit as in the plan: „Elternzeit“ or „abwesend“ for this viewer. Every appointment (calendar.edit sees
  // all), the print view (`?print=1`) only those for „Alle“ unless it asks for the internal ones (`&internal=1`).
  const calendar = getYearCalendar(db, admin.facilityId, year, {
    showsProtected: seesProtectedCodes(admin), parentalLeaveViewer: admin, eventAudience: eventAudienceFor(db, admin, view),
  })
  return { ...calendar, requests: calendarLeaveRequests(db, admin, admin.facilityId, year) }
})
