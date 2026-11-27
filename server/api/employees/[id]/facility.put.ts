import type { EmployeeMoveResultDto } from '../../../../shared/types/api'
import { employeeFacilitySchema, idParams } from '../../../schemas'
import { moveEmployeeToFacility } from '../../../services/employees'

export default defineServiceHandler(async (event): Promise<EmployeeMoveResultDto> => {
  const provider = await requirePermission(event, 'employees.moveFacility', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { facilityId } = await readValidatedBody(event, employeeFacilitySchema.parse)
  // `inspectionsRemoved`: inspection records the new facility cannot show (the page says so).
  return moveEmployeeToFacility(useDb(), provider, id, facilityId)
})
