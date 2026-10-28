import { idParams, stampingSchema } from '../../../schemas'
import { setStampingOptions } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  setStampingOptions(useDb(), admin.facilityId, id, await readValidatedBody(event, stampingSchema.parse),
    admin.permissions, admin.employeeId)
  return { ok: true }
})
