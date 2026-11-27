import { todayIso } from '../../../../shared/domain/dates'
import { eventAttendanceSchema, idParams } from '../../../schemas'
import { confirmEventAttendance } from '../../../services/eventRequirements'

/** Saves „Teilnahme bestätigen“: each ticked person gets the Pflichttermin entry, the others lose the one from here. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { employeeIds } = await readValidatedBody(event, eventAttendanceSchema.parse)
  confirmEventAttendance(useDb(), admin.facilityId, id, employeeIds, todayIso())
  return { ok: true }
})
