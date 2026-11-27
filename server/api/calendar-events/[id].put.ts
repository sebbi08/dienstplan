import { todayIso } from '../../../shared/domain/dates'
import { can } from '../../../shared/domain/permissions'
import { calendarEventSchema, idParams } from '../../schemas'
import { assertCurrentEventClient, updateCalendarEvent } from '../../services/calendar'

/** A page from before „Wer sieht den Termin?“ gets a clear message (reload) instead of a bare 400. */
const eventBody = (body: unknown) => calendarEventSchema.parse(assertCurrentEventClient(body))

/** A „Pflichttermin“ only for whoever may also enter Pflichttermine (employees.edit; the service says 403 otherwise). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'calendar.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateCalendarEvent(useDb(), admin.facilityId, id, await readValidatedBody(event, eventBody), {
    mayRecord: can(admin.permissions, 'employees.edit'), today: todayIso(),
  })
  return { ok: true }
})
