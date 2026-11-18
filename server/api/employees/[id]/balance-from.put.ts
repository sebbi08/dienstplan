import { balanceFromSchema, idParams } from '../../../schemas'
import { setBalanceFrom } from '../../../services/employees'

/** „Stundenkonto ab“ of an employee (null = from the first weekly hours). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { balanceFrom } = await readValidatedBody(event, balanceFromSchema.parse)
  setBalanceFrom(useDb(), admin.facilityId, id, balanceFrom, admin)
  return { ok: true }
})
