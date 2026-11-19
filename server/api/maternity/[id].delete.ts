import { idParams, maternityDeleteQuery } from '../../schemas'
import { deleteMaternityCase } from '../../services/maternity'

/** Deletes a Mutterschutz case entered by mistake; with `?removeEntries=1` (plan.edit) also the days it booked in the plan. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { removeEntries } = await getValidatedQuery(event, maternityDeleteQuery.parse)
  return deleteMaternityCase(useDb(), admin, scope, id, removeEntries === '1')
})
