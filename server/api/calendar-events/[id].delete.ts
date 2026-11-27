import { can } from '../../../shared/domain/permissions'
import { idParams } from '../../schemas'
import { deleteCalendarEvent } from '../../services/calendar'

/** A „Pflichttermin“ only for whoever may also enter Pflichttermine (employees.edit); its confirmed entries stay. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'calendar.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCalendarEvent(useDb(), admin.facilityId, id, { mayRecord: can(admin.permissions, 'employees.edit') })
  return { ok: true }
})
