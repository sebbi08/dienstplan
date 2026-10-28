import { contractSchema, idParams } from '../../../schemas'
import { setContract } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  const provider = await requirePermission(event, 'employees.contractEdit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  setContract(useDb(), provider.facilityId, id, await readValidatedBody(event, contractSchema.parse))
  return { ok: true }
})
