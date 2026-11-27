import { todayIso } from '../../../../shared/domain/dates'
import type { EventAttendanceDto } from '../../../../shared/types/api'
import { idParams } from '../../../schemas'
import { getEventAttendance } from '../../../services/eventRequirements'

/** „Teilnahme bestätigen“ of a Pflichttermin: whom it is meant for (whoever enters Pflichttermine; the dialog lives in the calendar). */
export default defineServiceHandler(async (event): Promise<EventAttendanceDto> => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEventAttendance(useDb(), admin.facilityId, id, todayIso())
})
