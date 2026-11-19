import { todayIso } from '../../../../shared/domain/dates'
import { bemCompleteSchema, idParams } from '../../../schemas'
import { completeBem } from '../../../services/bem'

/** „Abschließen“ of an accepted BEM, dated. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { date } = await readValidatedBody(event, bemCompleteSchema.parse)
  completeBem(useDb(), scope, id, date, todayIso())
  return { ok: true }
})
