import { employeeFacilitySchema, idParams } from '../../../schemas'
import { moveEmployeeToFacility } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  const provider = await requirePermission(event, 'employees.moveFacility', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { facilityId } = await readValidatedBody(event, employeeFacilitySchema.parse)
  moveEmployeeToFacility(useDb(), provider, id, facilityId)
  return { ok: true }
})
