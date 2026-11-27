import type { CalendarEventAudienceDto } from '../../../shared/types/api'
import { calendarEventAudienceQuery } from '../../schemas'
import { calendarEventAudience } from '../../services/calendar'

/** „Wer sieht den Termin?“: the facility's groups and staff the appointment dialog offers (whoever manages the calendar). */
export default defineServiceHandler(async (event): Promise<CalendarEventAudienceDto> => {
  const admin = await requirePermission(event, 'calendar.edit')
  const { eventId } = await getValidatedQuery(event, calendarEventAudienceQuery.parse)
  return calendarEventAudience(useDb(), admin.facilityId, undefined, eventId ?? null)
})
