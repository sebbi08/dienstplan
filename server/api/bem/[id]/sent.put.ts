import { todayIso } from '../../../../shared/domain/dates'
import { bemSentSchema, idParams } from '../../../schemas'
import { setBemSent } from '../../../services/bem'

/** „Verschickt am“ of the BEM invitation (null clears it), only while no answer is entered. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { invitedOn } = await readValidatedBody(event, bemSentSchema.parse)
  setBemSent(useDb(), scope, id, invitedOn, todayIso())
  return { ok: true }
})
