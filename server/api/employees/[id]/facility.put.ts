import { employeeFacilitySchema, idParams } from '../../../schemas'
import { moveEmployeeToFacility } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { facilityId } = await readValidatedBody(event, employeeFacilitySchema.parse)
  moveEmployeeToFacility(useDb(), id, facilityId)
  return { ok: true }
})
